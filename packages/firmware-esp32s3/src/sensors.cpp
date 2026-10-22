#include "freshflite_sensors.h"

#include "freshflite_packet.h"
#include "freshflite_pins.h"

#include <math.h>

#include <Adafruit_LIS3DH.h>
#include <Adafruit_SHT31.h>
#include <Wire.h>

namespace {

constexpr int16_t kBenchTempCenti = -145;
constexpr uint16_t kBenchHumidityCenti = 8450;
constexpr uint8_t kBenchBattery = 98;
constexpr uint16_t kBenchSealedLux = 18;
constexpr uint16_t kBenchOpenLux = 420;

Adafruit_SHT31 sht;
Adafruit_LIS3DH lis;
bool benchMode = true;
bool lidBreach = false;
bool scriptedAccel = false;
int16_t scriptedMilliG = BENCH_STATIONARY_MG;

uint16_t luxFromAdc() {
    const int raw = analogRead(PIN_TEMT6000_ADC);
    if (raw < 0) {
        return 0;
    }
    return static_cast<uint16_t>((static_cast<uint32_t>(raw) * 300u) / 4095u);
}

SensorSample benchSample() {
    SensorSample sample{};
    sample.temperature_centi = kBenchTempCenti;
    sample.humidity_centi = kBenchHumidityCenti;
    sample.battery_soc_pct = kBenchBattery;
    sample.lux = lidBreach ? kBenchOpenLux : kBenchSealedLux;
    sample.tamper_status = sample.lux > LUX_BREACH_ABOVE ? TAMPER_STATUS_LID_BREACH : TAMPER_STATUS_OK;
    sample.peak_accel_mG = scriptedAccel ? scriptedMilliG : BENCH_STATIONARY_MG;
    return sample;
}

}  // namespace

bool sensors_begin() {
    pinMode(PIN_LIS3DH_INT1, INPUT);
    analogReadResolution(12);
    analogSetPinAttenuation(PIN_TEMT6000_ADC, ADC_11db);
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

    const bool shtOk = sht.begin(SHT31_I2C_ADDR);
    const bool lisOk = lis.begin(LIS3DH_I2C_ADDR);
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

    benchMode = !(shtOk && lisOk);
    if (!benchMode) {
        lis.setRange(LIS3DH_RANGE_4_G);
        lis.setDataRate(LIS3DH_DATARATE_10_HZ);
    }
    return !benchMode;
}

bool sensors_is_bench() {
    return benchMode;
}

void sensors_set_lid_breach(bool open) {
    lidBreach = open;
}

void sensors_set_scripted_accel_mg(int16_t milliG) {
    scriptedAccel = true;
    scriptedMilliG = milliG;
}

SensorSample sensors_read() {
    if (benchMode) {
        return benchSample();
    }

    SensorSample sample = benchSample();
    const float temperature = sht.readTemperature();
    const float humidity = sht.readHumidity();
    if (!isnan(temperature)) {
        sample.temperature_centi = static_cast<int16_t>(lroundf(temperature * 100.0f));
    }
    if (!isnan(humidity)) {
        const long centi = lroundf(humidity * 100.0f);
        if (centi > 0 && centi <= 65535) {
            sample.humidity_centi = static_cast<uint16_t>(centi);
        }
    }

    lis.read();
    const float gx = lis.x_g;
    const float gy = lis.y_g;
    const float gz = lis.z_g;
    const float magnitude = sqrtf((gx * gx) + (gy * gy) + (gz * gz));
    const int32_t milliG = lroundf(magnitude * 1000.0f);
    if (!scriptedAccel && milliG >= -32768 && milliG <= 32767) {
        sample.peak_accel_mG = static_cast<int16_t>(milliG);
    }

    if (!lidBreach) {
        sample.lux = luxFromAdc();
    }
    sample.tamper_status = (lidBreach || sample.lux > LUX_BREACH_ABOVE) ? TAMPER_STATUS_LID_BREACH : TAMPER_STATUS_OK;
    return sample;
}
