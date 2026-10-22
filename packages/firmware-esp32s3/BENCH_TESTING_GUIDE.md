# FreshFlite ESP32-S3 bench guide

This guide is for the person at the bench. You do not need to change any code. The DevKit talks to the computer over USB. The serial monitor is the whole test panel.

Use **3.3 V logic only**. Do not connect a 5 V pin to the ESP32, the sensors, or the modem data lines. The SIM7600E-H needs its own power supply. Share one ground between the DevKit and the modem. Do not power the modem from the DevKit 3.3 V pin.

A bare DevKit with nothing wired still runs. The firmware prints `BENCH_HIL_SIMULATION_MODE` and answers the same keys with scripted cold-chain numbers.

## Breadboard

Wire one row at a time. Unplug USB before you move a jumper.

| From | To | Notes |
| --- | --- | --- |
| DevKit 3V3 | SHT31 VIN, LIS3DH VIN, TEMT6000 collector | Sensor power. Not the modem. |
| DevKit GND | SHT31 GND, LIS3DH GND, TEMT6000 10 kΩ, modem GND | One common ground. |
| GPIO 8 | SHT31 SDA and LIS3DH SDA | Shared I2C data. |
| GPIO 9 | SHT31 SCL and LIS3DH SCL | Shared I2C clock. |
| GPIO 10 | LIS3DH INT1 | Leave the LIS3DH SDO/SA0 pin low so the address stays `0x18`. |
| SHT31 address | `0x44` | ADDR pin low or open, per the breakout. |
| GPIO 4 | TEMT6000 emitter | Also connect a 10 kΩ resistor from GPIO 4 to GND. |
| GPIO 17 | SIM7600 TXD | Crossover: modem transmit goes into the ESP receive pin. |
| GPIO 18 | SIM7600 RXD | Crossover: ESP transmit goes into the modem receive pin. |
| GPIO 21 | SIM7600 PWRKEY | Idle high. The firmware pulls it low for 1.5 seconds to sleep or wake the modem. |

Sealed cargo is below 50 lux. A lid breach is anything above 200 lux on GPIO 4.

## Load the firmware from Cursor

1. Plug the ESP32-S3 DevKitC-1 into USB. Use a data cable.
2. Install the PlatformIO IDE extension if Cursor asks for it.
3. Open `packages/firmware-esp32s3/platformio.ini`.
4. On the PlatformIO status bar, choose the board port, then click **Upload** (the arrow).
5. When the upload finishes, click **Serial Monitor**. The speed is **115200**.

You should see `FreshFlite ESP32-S3 bench` and the five keys. If the monitor is blank, press the EN button on the DevKit once.

## Keys

Type one letter and press Enter. Lower case works too.

| Key | What you should see |
| --- | --- |
| `P` | One ground frame as 34 hex characters, then temperature, humidity, battery, tamper, and acceleration. |
| `T` | Takeoff at 1380 mG. The pod sends `AT+CPOWD=1`, pulses PWRKEY for 1500 ms, turns Wi-Fi and Bluetooth off, and stores a 17-byte silent frame. |
| `B` | Lid breach. Tamper becomes `0x01` and the scripted light reads 420 lux. Press `B` again to seal it. |
| `L` | Landing at 1000 mG. The modem gets another 1500 ms PWRKEY pulse and the stored frames are printed. A broker acknowledgement is printed only when a modem or a Wi-Fi broker actually accepts the burst. A bare board must say the burst was not acknowledged. |
| `S` | The pin list, bench or live mode, flight state, and the current sample. |

Bench order: `S`, then `P`, then `B`, then `B` again, then `T`, then `L`.

The silent log on a real flight is written to `/spiffs/flight_ringbuf.bin` right after takeoff and again every 60 seconds. `T` and `L` skip the 15 second takeoff wait and the 180 second landing wait so you can finish the check at the desk.
