#pragma once

#include <stdint.h>

/** Section 3.1 pod wiring. I2C is shared by the SHT31 and the LIS3DH. */

constexpr uint8_t PIN_I2C_SDA = 8;
constexpr uint8_t PIN_I2C_SCL = 9;
constexpr uint8_t SHT31_I2C_ADDR = 0x44;
constexpr uint8_t LIS3DH_I2C_ADDR = 0x18;
constexpr uint8_t PIN_LIS3DH_INT1 = 10;
constexpr uint8_t PIN_SIM7600_RXD = 17;
constexpr uint8_t PIN_SIM7600_TXD = 18;
constexpr uint8_t PIN_SIM7600_PWRKEY = 21;
constexpr uint8_t PIN_TEMT6000_ADC = 4;

/** Sealed cargo reads below this. A lid breach is strictly above the breach floor. */
constexpr uint16_t LUX_SEALED_BELOW = 50;
constexpr uint16_t LUX_BREACH_ABOVE = 200;

constexpr int16_t TAKEOFF_THRESHOLD_MG = 1250;
constexpr uint32_t TAKEOFF_HOLD_MS = 15000;
constexpr int16_t TOUCHDOWN_CENTER_MG = 1000;
constexpr int16_t TOUCHDOWN_WINDOW_MG = 80;
constexpr uint32_t TOUCHDOWN_HOLD_MS = 180000;
constexpr uint32_t PWRKEY_PULSE_MS = 1500;
constexpr uint32_t SPIFFS_LOG_PERIOD_MS = 60000;
constexpr int16_t BENCH_TAKEOFF_MG = 1380;
constexpr int16_t BENCH_STATIONARY_MG = 1000;

constexpr const char* FRESHFLITE_POD_ID = "FF-S3-01A";
constexpr const char* FRESHFLITE_BURST_TOPIC = "freshflite/v1/pods/FF-S3-01A/burst";
constexpr const char* FRESHFLITE_MQTT_HOST = "mqtt.local";
constexpr uint16_t FRESHFLITE_MQTT_PORT = 1883;

/** Leave empty on the bench. Set a real SSID only when a Wi-Fi broker is in reach. */
#ifndef FRESHFLITE_WIFI_SSID
#define FRESHFLITE_WIFI_SSID ""
#endif
#ifndef FRESHFLITE_WIFI_PASSWORD
#define FRESHFLITE_WIFI_PASSWORD ""
#endif

constexpr const char* SPIFFS_RING_PATH = "/spiffs/flight_ringbuf.bin";
