#include "freshflite_fsm.h"

#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    const uint32_t started = millis();
    while (!Serial && millis() - started < 1500) {
        delay(10);
    }
    delay(200);
    fsm_setup();
}

void loop() {
    fsm_loop();
}
