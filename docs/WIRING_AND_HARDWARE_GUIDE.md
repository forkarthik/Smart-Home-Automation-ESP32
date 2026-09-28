# ESP32 Smart Home Automation — Hardware & Wiring Guide

This guide details the complete hardware configuration, electrical isolation, driver circuitry, and wiring schematics for safely controlling four AC or DC electrical appliances using the ESP32 microcontroller.

---

## 1. Hardware Pin Assignment

| Appliance Name | Control Type | ESP32 GPIO Pin | ON State Logic | OFF State Logic | External Driver |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Light 1** | Digital Output | **GPIO 16** | HIGH (3.3V) | LOW (0V) | Relay Ch 1 (Isolated) |
| **Light 2** | Digital Output | **GPIO 17** | HIGH (3.3V) | LOW (0V) | Relay Ch 2 (Isolated) |
| **Fan 1** | Digital Output | **GPIO 18** | HIGH (3.3V) | LOW (0V) | Relay Ch 3 (Isolated + Snubber) |
| **Fan 2** | Digital Output | **GPIO 19** | HIGH (3.3V) | LOW (0V) | Relay Ch 4 (Isolated + Snubber) |

---

## 2. Critical Electrical Safety Rules

> [!CAUTION]
> **MAINS VOLTAGE WARNING (110V - 240V AC):**
> High voltage electrical wiring presents severe risks of electric shock, electrocution, and fire. Always disconnect mains power from the breaker/fuse box before handling AC wiring. Never touch bare terminals or contacts while powered.

1. **No Direct AC Connection to ESP32:**
   The ESP32 runs strictly on 3.3V logic levels. Under no circumstances should AC mains (110V/230V) or loads exceeding 12mA be connected directly to ESP32 GPIO pins.
2. **Optocoupler Isolation:**
   Use a 4-channel relay module with built-in optoisolators (e.g. PC817). This creates complete galvanic isolation between the low-voltage ESP32 digital logic side and the high-voltage relay coil / AC contact side.
3. **Power Supply Separation (JD-VCC Jumper):**
   Standard 4-channel relay boards feature a 3-pin jumper labeled `VCC - JD-VCC - GND`:
   - Remove the jumper cap connecting `VCC` and `JD-VCC`.
   - Connect **ESP32 3.3V** to Relay Board **VCC** (powers the optocoupler LEDs only, drawing < 5mA per channel).
   - Connect an external **5V DC Power Adapter (1A - 2A)** to **JD-VCC** and **Relay GND** (powers the electro-mechanical relay coils).
   - Do **NOT** connect the external 5V GND to the ESP32 GND when using true optocoupler isolation. This prevents relay switching transients and back-EMF from resetting the ESP32!
4. **Inductive Load Protection (Fans & Motors):**
   Fans are inductive loads. When switched OFF, the collapsing magnetic field creates a high-voltage back-EMF spike that can pit relay contacts and cause electromagnetic interference (EMI).
   - Install an **RC Snubber circuit** (0.1µF 400V capacitor in series with a 100Ω 2W resistor) or a **Metal Oxide Varistor (MOV 14D471K)** across the relay output contacts (COM and NO) for Fan 1 and Fan 2.

---

## 3. Wiring Diagram

```
           +-----------------------------+
           |       ESP32 DevKit V1       |
           |                             |
           |  [GPIO 16] -----------------+-----> Relay IN 1 (Light 1)
           |  [GPIO 17] -----------------+-----> Relay IN 2 (Light 2)
           |  [GPIO 18] -----------------+-----> Relay IN 3 (Fan 1)
           |  [GPIO 19] -----------------+-----> Relay IN 4 (Fan 2)
           |  [3.3V]    -----------------+-----> Relay Board VCC (Opto Logic)
           |  [GND]     -----------------+-----> (Connected if non-isolated)
           |  [VIN/5V]  <-- USB 5V In    |
           +-----------------------------+

           +-----------------------------+
           |  4-Channel Opto Relay Board |
           |                             |
           |  [JD-VCC]  <----------------+-----> External +5V DC (Coil Supply)
           |  [GND]     <----------------+-----> External Power Supply GND
           |                             |
           |  Relay 1: COM + NO ---------+-----> AC Phase -> Light 1 -> AC Neutral
           |  Relay 2: COM + NO ---------+-----> AC Phase -> Light 2 -> AC Neutral
           |  Relay 3: COM + NO + Snubber+-----> AC Phase -> Fan 1   -> AC Neutral
           |  Relay 4: COM + NO + Snubber+-----> AC Phase -> Fan 2   -> AC Neutral
           +-----------------------------+
```

---

## 4. Relay Output Terminal Connections

Every relay channel provides three screw terminals:
- **COM (Common):** Connect the incoming AC Mains Live / Phase wire here.
- **NO (Normally Open):** Connect the wire going to the appliance Live terminal here. (When GPIO is HIGH, the relay energizes, closing COM to NO and turning the appliance ON).
- **NC (Normally Closed):** Leave unconnected for standard ON/OFF home automation.

---

## 5. Startup & Reboot Safety Guarantee

In `esp32_home_control.ino`:
```cpp
void setupHardwarePins() {
  for (int i = 0; i < 4; i++) {
    pinMode(appliances[i].gpio, OUTPUT);
    digitalWrite(appliances[i].gpio, RELAY_OFF);
  }
}
```
- Pins 16, 17, 18, and 19 are selected because they are standard GPIOs without boot-strap conflicts (unlike GPIO 0, 2, 12, or 15 which can prevent ESP32 from booting if pulled high/low externally).
- All 4 pins are driven to 0V (LOW) immediately upon microcontroller initialization, ensuring appliances stay safely OFF during power outages, reboots, and firmware updates.
