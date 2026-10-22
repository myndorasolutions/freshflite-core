#pragma once

#include <stddef.h>
#include <stdint.h>

/**
 * 17-byte little-endian FreshFliteRecord.
 * CRC32 covers bytes 0..12 only and is stored at offset 13.
 * This header is host-clean so g++ and clang++ can seal frames without Arduino.
 */
struct __attribute__((packed)) FreshFliteRecord {
    uint32_t unix_timestamp;     // 4B: UTC epoch seconds
    int16_t  temperature_centi;  // 2B: 0.01 deg C resolution
    uint16_t humidity_centi;     // 2B: 0.01 % RH resolution
    uint8_t  battery_soc_pct;    // 1B: 0 - 100%
    uint8_t  tamper_status;      // 1B: 0x00=OK, 0x01=Lid Breach (>200 lux), 0x02=Shock Drop
    uint8_t  flight_state;       // 1B: 0x00=GROUND_PREFLIGHT, 0x01=IN_FLIGHT_SILENT, 0x02=POST_TOUCHDOWN_BURST
    int16_t  peak_accel_mG;      // 2B: Peak acceleration in milli-G
    uint32_t checksum_crc32;     // 4B: IEEE 802.3 CRC32 over bytes 0..12
};

static_assert(sizeof(FreshFliteRecord) == 17, "FreshFliteRecord must be exactly 17 bytes");

constexpr uint8_t FLIGHT_STATE_GROUND_PREFLIGHT = 0x00;
constexpr uint8_t FLIGHT_STATE_IN_FLIGHT_SILENT = 0x01;
constexpr uint8_t FLIGHT_STATE_POST_TOUCHDOWN_BURST = 0x02;
constexpr uint8_t TAMPER_STATUS_OK = 0x00;
constexpr uint8_t TAMPER_STATUS_LID_BREACH = 0x01;
constexpr uint8_t TAMPER_STATUS_SHOCK_DROP = 0x02;
constexpr size_t FRESHFLITE_PAYLOAD_BYTES = 13;

/** Reflected IEEE 802.3 CRC32. ASCII "123456789" returns 0xCBF43926. */
inline uint32_t compute_crc32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t index = 0; index < len; ++index) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; ++bit) {
            if ((crc & 1u) == 1u) {
                crc = (crc >> 1) ^ 0xEDB88320u;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc ^ 0xFFFFFFFFu;
}

/** Write the CRC of bytes 0..12 into the trailer. The host must be little-endian. */
inline void seal_record(FreshFliteRecord& record) {
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    record.checksum_crc32 = compute_crc32(bytes, FRESHFLITE_PAYLOAD_BYTES);
}
