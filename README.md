# Smart Vending Machine (RPi 4 + dc motor)

A college-level project for an automatic vending machine controlled via a web interface.

## 🛠 Hardware Setup

| Component | RPi Pin (Physical) | RPi Pin (GPIO) | Notes |
| :--- | :--- | :--- | :--- |
| **SG90 Brown (GND)** | Pin 6, 9, 14, etc. | GND | Common ground |
| **SG90 Red (5V)** | Pin 2 or 4 | 5V | Use external 5V if Pi resets |
| **SG90 Orange (Signal)** | Pin 12 | **GPIO 18** | PWM Capable Pin |

## 🚀 Software Setup (on Raspberry Pi)

1.  **System Preparation**:
    ```bash
    sudo apt update
    sudo apt install python3-pip python3-flask python3-gpiozero pigpio
    sudo systemctl enable pigpiod
    sudo systemctl start pigpiod
    ```

2.  **Clone/Copy Files**:
    Place `app.py`, `templates/`, and `static/` in a folder named `vending_machine`.

3.  **Run the Server**:
    ```bash
    python3 app.py
    ```

4.  **Access**:
    Open a browser on your phone and go to `http://<YOUR_PI_IP>:5000`.

## 📐 Calibration Guide

The SG90 servo rotation depends on the `DISPENSE_ANGLE` and `IDLE_ANGLE` values in `app.py`.

-   **Idle Position**: Set to `-1.0` (0 degrees).
-   **Dispense Position**: Set to `0.5` (approx 135 degrees total rotation).
-   **Adjustment**: If the coil turns too much or too little, adjust `DISPENSE_ANGLE` between `-1.0` and `1.0`.

## 📋 Features

-   **Premium UI**: Glassmorphic design with micro-animations.
-   **Debounce**: Prevents multiple items from falling due to rapid clicking (2s delay).
-   **Logging**: All successful dispenses are logged in `vending.log`.
-   **Responsive**: Works perfectly on mobile browsers (via QR scan).

---
*Created for College Level Engineering Project.*
