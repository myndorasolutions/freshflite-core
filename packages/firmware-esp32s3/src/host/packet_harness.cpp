#include <stdint.h>
#include <stdio.h>

#include "freshflite_packet.h"

int main() {
    const uint8_t check[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
    const uint32_t checkCrc = compute_crc32(check, sizeof(check));

    FreshFliteRecord record{};
    record.unix_timestamp = 1760421600u;
    record.temperature_centi = -150;
    record.humidity_centi = 8520;
    record.battery_soc_pct = 91;
    record.tamper_status = 0;
    record.flight_state = 1;
    record.peak_accel_mG = 1320;
    seal_record(record);

    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    for (int index = 0; index < 17; ++index) {
        printf("%02x", static_cast<unsigned>(bytes[index]));
    }
    printf("\ncrc32=%08lx\n", static_cast<unsigned long>(checkCrc));
    return checkCrc == 0xCBF43926u ? 0 : 1;
}
