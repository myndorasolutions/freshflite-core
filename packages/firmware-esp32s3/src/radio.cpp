#include "freshflite_radio.h"

#include "freshflite_pins.h"

#include <Client.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp32-hal-bt.h>

#include <stdio.h>
#include <string.h>

namespace {

bool netOpen = false;

bool atExpect(const char* command, const char* expect, uint32_t timeoutMs) {
    if (command[0] != '\0') {
        while (Serial1.available() > 0) {
            Serial1.read();
        }
        Serial1.print(command);
    }
    char buffer[180];
    size_t length = 0;
    buffer[0] = '\0';
    const uint32_t started = millis();
    while (millis() - started < timeoutMs) {
        while (Serial1.available() > 0 && length + 1 < sizeof(buffer)) {
            buffer[length++] = static_cast<char>(Serial1.read());
            buffer[length] = '\0';
        }
        if (expect[0] != '\0' && strstr(buffer, expect) != nullptr) {
            return true;
        }
        delay(10);
    }
    return false;
}

bool modemAnswers() {
    return atExpect("AT\r\n", "OK", 700);
}

void pulsePwrkey() {
    Serial.println("PWRKEY GPIO 21 LOW for 1500 ms");
    digitalWrite(PIN_SIM7600_PWRKEY, LOW);
    delay(PWRKEY_PULSE_MS);
    digitalWrite(PIN_SIM7600_PWRKEY, HIGH);
}

class Sim7600Client : public Client {
  public:
    int connect(IPAddress ip, uint16_t port) override {
        (void)ip;
        (void)port;
        return 0;
    }

    int connect(const char* host, uint16_t port) override {
        if (!netOpen) {
            if (!atExpect("AT+NETOPEN\r\n", "OK", 5000)) {
                return 0;
            }
            netOpen = true;
        }
        char command[96];
        snprintf(command, sizeof(command), "AT+CIPOPEN=0,\"TCP\",\"%s\",%u\r\n", host, static_cast<unsigned>(port));
        linkUp = atExpect(command, "OK", 8000);
        return linkUp ? 1 : 0;
    }

    size_t write(uint8_t value) override {
        const uint8_t byte = value;
        return write(&byte, 1);
    }

    size_t write(const uint8_t* buffer, size_t size) override {
        if (!linkUp || size == 0) {
            return 0;
        }
        char command[40];
        snprintf(command, sizeof(command), "AT+CIPSEND=0,%u\r\n", static_cast<unsigned>(size));
        if (!atExpect(command, ">", 3000)) {
            return 0;
        }
        Serial1.write(buffer, size);
        if (!atExpect("", "OK", 4000)) {
            return 0;
        }
        return size;
    }

    int available() override {
        return Serial1.available();
    }

    int read() override {
        if (Serial1.available() <= 0) {
            return -1;
        }
        return Serial1.read();
    }

    int read(uint8_t* buffer, size_t size) override {
        size_t count = 0;
        while (count < size && Serial1.available() > 0) {
            buffer[count++] = static_cast<uint8_t>(Serial1.read());
        }
        return static_cast<int>(count);
    }

    int peek() override {
        return Serial1.peek();
    }

    void flush() override {
        Serial1.flush();
    }

    void stop() override {
        atExpect("AT+CIPCLOSE=0\r\n", "OK", 2000);
        linkUp = false;
    }

    uint8_t connected() override {
        return linkUp ? 1 : 0;
    }

    operator bool() override {
        return linkUp;
    }

  private:
    bool linkUp = false;
};

Sim7600Client modemClient;
PubSubClient modemMqtt(modemClient);
WiFiClient wifiClient;
PubSubClient wifiMqtt(wifiClient);

void printPayload(const uint8_t* data, size_t length) {
    const size_t shown = length > 128 ? 128 : length;
    Serial.printf("Burst %u bytes on %s\n", static_cast<unsigned>(length), FRESHFLITE_BURST_TOPIC);
    for (size_t index = 0; index < shown; ++index) {
        Serial.printf("%02X", data[index]);
    }
    if (shown < length) {
        Serial.print("...");
    }
    Serial.println();
}

bool publishWith(PubSubClient& mqtt, const uint8_t* data, size_t length) {
    mqtt.setServer(FRESHFLITE_MQTT_HOST, FRESHFLITE_MQTT_PORT);
    mqtt.setSocketTimeout(3);
    if (length + 64 > 256) {
        mqtt.setBufferSize(static_cast<uint16_t>(length + 64));
    }
    if (!mqtt.connect(FRESHFLITE_POD_ID)) {
        return false;
    }
    const bool ok = mqtt.publish(FRESHFLITE_BURST_TOPIC, data, static_cast<unsigned int>(length));
    mqtt.disconnect();
    return ok;
}

}  // namespace

void radio_begin() {
    pinMode(PIN_SIM7600_PWRKEY, OUTPUT);
    digitalWrite(PIN_SIM7600_PWRKEY, HIGH);
    Serial1.begin(115200, SERIAL_8N1, PIN_SIM7600_RXD, PIN_SIM7600_TXD);
}

void radio_enter_silent() {
    Serial.println("AT+CPOWD=1");
    Serial1.print("AT+CPOWD=1\r\n");
    delay(100);
    pulsePwrkey();
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    btStop();
    Serial.println("RF off: WiFi.mode(WIFI_OFF) and btStop()");
}

void radio_wake() {
    pulsePwrkey();
    Serial.println("SIM7600E-H wake pulse sent");
}

bool radio_publish_burst(const uint8_t* data, size_t length) {
    printPayload(data, length);
    if (modemAnswers()) {
        if (publishWith(modemMqtt, data, length)) {
            Serial.println("Broker ack: yes (SIM7600)");
            return true;
        }
        Serial.println("SIM7600 answered AT but the MQTT publish was not acknowledged");
    }
    if (strlen(FRESHFLITE_WIFI_SSID) > 0) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(FRESHFLITE_WIFI_SSID, FRESHFLITE_WIFI_PASSWORD);
        const uint32_t started = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - started < 5000) {
            delay(100);
        }
        if (WiFi.status() == WL_CONNECTED && publishWith(wifiMqtt, data, length)) {
            Serial.println("Broker ack: yes (Wi-Fi)");
            return true;
        }
    }
    Serial.println("Broker ack: no. Burst is sealed locally; no modem or Wi-Fi broker answered.");
    return false;
}
