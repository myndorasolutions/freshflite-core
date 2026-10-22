#include "freshflite_fsm.h"

#include "freshflite_packet.h"
#include "freshflite_pins.h"
#include "freshflite_radio.h"
#include "freshflite_sensors.h"

#include <Arduino.h>
#include <FS.h>
#include <SPIFFS.h>

#include <cctype>
#include <stdio.h>
#include <string.h>

namespace {

constexpr size_t kFrameBytes = 17;
constexpr size_t kRingCapacity = 256 * kFrameBytes;

enum class Phase : uint8_t { Ground, Silent, Burst };

Phase phase = Phase::Ground;
uint8_t ring[kRingCapacity];
size_t ringUsed = 0;
bool spiffsReady = false;
uint32_t lastLogMs = 0;
uint32_t lastSampleMs = 0;
uint32_t takeoffSince = 0;
bool takeoffArmed = false;
uint32_t landingSince = 0;
bool landingArmed = false;
bool lidOpen = false;
SensorSample latest{};

const char* phaseName(Phase value) {
    if (value == Phase::Silent) {
        return "IN_FLIGHT_SILENT";
    }
    if (value == Phase::Burst) {
        return "POST_TOUCHDOWN_BURST";
    }
    return "GROUND_PREFLIGHT";
}

uint8_t phaseCode(Phase value) {
    if (value == Phase::Silent) {
        return FLIGHT_STATE_IN_FLIGHT_SILENT;
    }
    if (value == Phase::Burst) {
        return FLIGHT_STATE_POST_TOUCHDOWN_BURST;
    }
    return FLIGHT_STATE_GROUND_PREFLIGHT;
}

void printCenti(int16_t centi) {
    const bool negative = centi < 0;
    uint16_t magnitude = static_cast<uint16_t>(negative ? -centi : centi);
    Serial.printf("%s%u.%02u", negative ? "-" : "", magnitude / 100, magnitude % 100);
}

void printSample(const SensorSample& sample) {
    Serial.print("temp ");
    printCenti(sample.temperature_centi);
    Serial.print(" C  humidity ");
    printCenti(static_cast<int16_t>(sample.humidity_centi));
    Serial.printf(" %%  battery %u%%  tamper 0x%02X  accel %d mG  lux %u\n",
                  sample.battery_soc_pct,
                  sample.tamper_status,
                  sample.peak_accel_mG,
                  sample.lux);
}

void printFrame(const FreshFliteRecord& record) {
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    Serial.print("frame ");
    for (size_t index = 0; index < kFrameBytes; ++index) {
        Serial.printf("%02X", bytes[index]);
    }
    Serial.println();
    Serial.printf("unix %lu  flight 0x%02X  crc 0x%08lX\n",
                  static_cast<unsigned long>(record.unix_timestamp),
                  record.flight_state,
                  static_cast<unsigned long>(record.checksum_crc32));
}

FreshFliteRecord sealFrom(const SensorSample& sample, uint8_t state) {
    FreshFliteRecord record{};
    record.unix_timestamp = 1760421600u + (millis() / 1000u);
    record.temperature_centi = sample.temperature_centi;
    record.humidity_centi = sample.humidity_centi;
    record.battery_soc_pct = sample.battery_soc_pct;
    record.tamper_status = sample.tamper_status;
    record.flight_state = state;
    record.peak_accel_mG = sample.peak_accel_mG;
    seal_record(record);
    return record;
}

void resetRing() {
    ringUsed = 0;
    if (spiffsReady) {
        SPIFFS.remove(SPIFFS_RING_PATH);
    }
}

void appendFrame(const SensorSample& sample, uint8_t state) {
    const FreshFliteRecord record = sealFrom(sample, state);
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    if (ringUsed + kFrameBytes <= kRingCapacity) {
        memcpy(ring + ringUsed, bytes, kFrameBytes);
        ringUsed += kFrameBytes;
    }
    if (spiffsReady) {
        File file = SPIFFS.open(SPIFFS_RING_PATH, FILE_APPEND);
        if (file) {
            file.write(bytes, kFrameBytes);
            file.close();
        } else if (ringUsed == kFrameBytes) {
            Serial.printf("SPIFFS could not open %s; frames stay in the RAM ring\n", SPIFFS_RING_PATH);
        }
    }
    lastLogMs = millis();
    printFrame(record);
    Serial.printf("ring %u bytes\n", static_cast<unsigned>(ringUsed));
}

size_t loadBurst(uint8_t* destination, size_t capacity) {
    if (spiffsReady) {
        File file = SPIFFS.open(SPIFFS_RING_PATH, FILE_READ);
        if (file) {
            const size_t size = file.size();
            const size_t count = size < capacity ? size : capacity;
            const size_t read = file.read(destination, count);
            file.close();
            if (read > 0) {
                return read;
            }
        }
    }
    const size_t count = ringUsed < capacity ? ringUsed : capacity;
    memcpy(destination, ring, count);
    return count;
}

void enterSilent(const SensorSample& sample) {
    if (phase == Phase::Silent) {
        return;
    }
    phase = Phase::Silent;
    takeoffArmed = false;
    landingArmed = false;
    radio_enter_silent();
    resetRing();
    Serial.println("state IN_FLIGHT_SILENT (0x01)");
    appendFrame(sample, FLIGHT_STATE_IN_FLIGHT_SILENT);
}

void enterBurst(const SensorSample& sample) {
    if (phase != Phase::Silent) {
        Serial.println("Landing flush waits for silent mode. Press T first.");
        return;
    }
    phase = Phase::Burst;
    landingArmed = false;
    appendFrame(sample, FLIGHT_STATE_POST_TOUCHDOWN_BURST);
    radio_wake();
    uint8_t burst[kRingCapacity];
    const size_t length = loadBurst(burst, sizeof(burst));
    Serial.printf("SPIFFS flush %u bytes from %s\n", static_cast<unsigned>(length), SPIFFS_RING_PATH);
    radio_publish_burst(burst, length);
}

void printMenu() {
    Serial.println();
    Serial.println("FreshFlite ESP32-S3 bench");
    Serial.println("[P] Ground ping: one 17-byte frame, hex and decoded");
    Serial.println("[T] Takeoff 1.38 g: enter ICAO silent mode");
    Serial.println("[B] Lid breach: TEMT6000 above 200 lux");
    Serial.println("[L] Landing 1.00 g: wake SIM7600 and flush the SPIFFS burst");
    Serial.println("[S] Pinout and diagnostics");
}

void printDiagnostics() {
    Serial.println("pin        function");
    Serial.println("GPIO 8     I2C SDA");
    Serial.println("GPIO 9     I2C SCL");
    Serial.printf("0x%02X       SHT31\n", SHT31_I2C_ADDR);
    Serial.printf("0x%02X       LIS3DH\n", LIS3DH_I2C_ADDR);
    Serial.println("GPIO 10    LIS3DH INT1");
    Serial.println("GPIO 17    SIM7600 TX into ESP RX");
    Serial.println("GPIO 18    ESP TX into SIM7600 RX");
    Serial.println("GPIO 21    SIM7600 PWRKEY, idle high, pulse low 1500 ms");
    Serial.println("GPIO 4     TEMT6000 ADC, sealed below 50 lux, breach above 200 lux");
    Serial.printf("mode       %s\n", sensors_is_bench() ? "BENCH_HIL_SIMULATION_MODE" : "LIVE_SENSORS");
    Serial.printf("state      %s\n", phaseName(phase));
    Serial.printf("spiffs     %s\n", spiffsReady ? "mounted" : "unavailable, RAM ring only");
    Serial.printf("ring       %u bytes\n", static_cast<unsigned>(ringUsed));
    printSample(latest);
    if (sensors_is_bench()) {
        Serial.println("battery    98 percent stand-in; this DevKit has no fuel gauge");
    }
}

void onKey(char key) {
    if (key == 'p') {
        const FreshFliteRecord record = sealFrom(latest, phaseCode(phase));
        printFrame(record);
        printSample(latest);
        return;
    }
    if (key == 't') {
        sensors_set_scripted_accel_mg(BENCH_TAKEOFF_MG);
        latest = sensors_read();
        Serial.printf("Takeoff %d mG\n", latest.peak_accel_mG);
        enterSilent(latest);
        return;
    }
    if (key == 'b') {
        lidOpen = !lidOpen;
        sensors_set_lid_breach(lidOpen);
        latest = sensors_read();
        Serial.println(lidOpen ? "Lid breach latched at 420 lux, tamper 0x01" : "Lid sealed, tamper 0x00");
        const FreshFliteRecord record = sealFrom(latest, phaseCode(phase));
        printFrame(record);
        printSample(latest);
        return;
    }
    if (key == 'l') {
        sensors_set_scripted_accel_mg(BENCH_STATIONARY_MG);
        latest = sensors_read();
        Serial.printf("Touchdown %d mG\n", latest.peak_accel_mG);
        enterBurst(latest);
        return;
    }
    if (key == 's') {
        printDiagnostics();
    }
}

void pollMotion(const SensorSample& sample) {
    if (phase == Phase::Ground) {
        if (sample.peak_accel_mG > TAKEOFF_THRESHOLD_MG) {
            if (!takeoffArmed) {
                takeoffArmed = true;
                takeoffSince = millis();
            } else if (millis() - takeoffSince >= TAKEOFF_HOLD_MS) {
                enterSilent(sample);
            }
        } else {
            takeoffArmed = false;
        }
        return;
    }
    if (phase != Phase::Silent) {
        return;
    }
    if (millis() - lastLogMs >= SPIFFS_LOG_PERIOD_MS) {
        appendFrame(sample, FLIGHT_STATE_IN_FLIGHT_SILENT);
    }
    const int16_t low = TOUCHDOWN_CENTER_MG - TOUCHDOWN_WINDOW_MG;
    const int16_t high = TOUCHDOWN_CENTER_MG + TOUCHDOWN_WINDOW_MG;
    if (sample.peak_accel_mG >= low && sample.peak_accel_mG <= high) {
        if (!landingArmed) {
            landingArmed = true;
            landingSince = millis();
        } else if (millis() - landingSince >= TOUCHDOWN_HOLD_MS) {
            enterBurst(sample);
        }
    } else {
        landingArmed = false;
    }
}

}  // namespace

void fsm_setup() {
    spiffsReady = SPIFFS.begin(true);
    radio_begin();
    const bool live = sensors_begin();
    latest = sensors_read();
    Serial.println(live ? "Sensors live on GPIO 8/9" : "BENCH_HIL_SIMULATION_MODE: I2C sensors did not start");
    printMenu();
}

void fsm_loop() {
    const uint32_t now = millis();
    if (now - lastSampleMs >= 200) {
        lastSampleMs = now;
        latest = sensors_read();
        pollMotion(latest);
    }
    while (Serial.available() > 0) {
        const char key = static_cast<char>(Serial.read());
        if (key == '\r' || key == '\n') {
            continue;
        }
        onKey(static_cast<char>(std::tolower(static_cast<unsigned char>(key))));
    }
}
