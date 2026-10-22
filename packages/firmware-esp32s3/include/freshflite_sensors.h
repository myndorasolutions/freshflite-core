#pragma once

#include <stdint.h>

struct SensorSample {
    int16_t temperature_centi;
    uint16_t humidity_centi;
    uint8_t battery_soc_pct;
    uint8_t tamper_status;
    int16_t peak_accel_mG;
    uint16_t lux;
};

bool sensors_begin();
bool sensors_is_bench();
SensorSample sensors_read();
void sensors_set_lid_breach(bool open);
void sensors_set_scripted_accel_mg(int16_t milliG);
