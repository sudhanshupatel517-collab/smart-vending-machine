import os
import time
import logging
import signal
import sys
import sqlite3
import threading
import razorpay
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Production CORS: Restrict to Vercel domain only
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGIN}})

# Razorpay Configuration
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

# Hardware Configuration
ITEMS = {
    "chips": {"name": "Chips", "pin1": 18, "pin2": 17, "price": 10},
    "biscuit": {"name": "Biscuits", "pin1": 23, "pin2": 27, "price": 10},
    "soda": {"name": "Soda", "pin1": 24, "pin2": 22, "price": 40},
    "chocolate": {"name": "Chocolate", "pin1": 25, "pin2": 5, "price": 20}
}
ROTATION_TIME = 2.0
GPIO_AVAILABLE = False
motors = {}
dispense_lock = threading.Lock() # Global lock to prevent concurrent motor triggers

# Database Initialization (SQLite for Idempotency)
DB_PATH = 'vending.db'
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('CREATE TABLE IF NOT EXISTS payments (payment_id TEXT PRIMARY KEY, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)')
    conn.commit()
    conn.close()

init_db()

try:
    from gpiozero import Motor
    from gpiozero.pins.pigpio import PiGPIOFactory
    factory = PiGPIOFactory()
    for item_id, info in ITEMS.items():
        motors[item_id] = Motor(forward=info['pin1'], backward=info['pin2'], pin_factory=factory)
        motors[item_id].stop()
    GPIO_AVAILABLE = True
    print("Hardware Ready.")
except Exception as e:
    print(f"Mock Mode Active: {e}")
    # Populate mock keys for health visibility
    for item_id in ITEMS:
        motors[item_id] = "MOCK"

# Logging
logging.basicConfig(filename='vending_prod.log', level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def graceful_exit(signum, frame):
    print("\nShutting down... Stopping all motors.")
    for motor in motors.values(): motor.stop()
    sys.exit(0)

signal.signal(signal.SIGINT, graceful_exit)
signal.signal(signal.SIGTERM, graceful_exit)

# Rate Limiting State
last_request_time = {}

@app.route('/api/health')
def health():
    return jsonify({
        "status": "healthy",
        "gpio_available": GPIO_AVAILABLE,
        "motors_initialized": list(motors.keys()),
        "uptime": time.time()
    })

@app.route('/api/create_order', methods=['POST'])
def create_order():
    try:
        data = request.get_json()
        cart = data.get('cart', [])
        if not cart: return jsonify({"status": "error", "message": "Cart empty"}), 400

        total_amount = 0
        for item in cart:
            if item['item_id'] in ITEMS:
                total_amount += ITEMS[item['item_id']]['price'] * item.get('quantity', 1) * 100

        order = razorpay_client.order.create({"amount": total_amount, "currency": "INR", "payment_capture": "1"})
        logging.info(f"Order created: {order['id']}")
        return jsonify({"status": "success", "order_id": order['id'], "amount": total_amount, "key": RAZORPAY_KEY_ID})
    except Exception as e:
        logging.error(f"Order Error: {e}")
        return jsonify({"status": "error", "message": "Backend Error"}), 500

@app.route('/api/verify_payment', methods=['POST'])
def verify_payment():
    data = request.get_json()
    p_id = data.get('razorpay_payment_id')
    o_id = data.get('razorpay_order_id')
    sig = data.get('razorpay_signature')
    cart = data.get('cart', [])

    # 1. Rate Limiting (Prevent Spam)
    now = time.time()
    if p_id in last_request_time and now - last_request_time[p_id] < 5:
        return jsonify({"status": "error", "message": "Rate limited"}), 429
    last_request_time[p_id] = now

    # 2. Idempotency Check (Persistent)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM payments WHERE payment_id = ?', (p_id,))
    if cursor.fetchone():
        conn.close()
        return jsonify({"status": "success", "stage": "dispense_success", "message": "Already dispensed"})

    # 3. Signature Verification
    try:
        razorpay_client.utility.verify_payment_signature({
            'razorpay_order_id': o_id, 'razorpay_payment_id': p_id, 'razorpay_signature': sig
        })
    except:
        conn.close()
        return jsonify({"status": "error", "message": "Security Violation"}), 400

    # 4. Atomic Dispense with Global Lock
    if not dispense_lock.acquire(blocking=True, timeout=5):
        conn.close()
        return jsonify({"status": "error", "message": "Machine Busy"}), 503

    try:
        logging.info(f"Verified: {p_id}. Starting dispense.")
        # Insert into DB *before* dispensing to ensure idempotency even if motor fails half-way
        cursor.execute('INSERT INTO payments (payment_id) VALUES (?)', (p_id,))
        conn.commit()
        
        for item in cart:
            tid = item['item_id']
            qty = item.get('quantity', 1)
            if tid in ITEMS:
                for _ in range(qty):
                    if GPIO_AVAILABLE and tid in motors:
                        try:
                            motors[tid].forward()
                            time.sleep(ROTATION_TIME)
                        finally:
                            motors[tid].stop()
                        time.sleep(0.5)
                    else:
                        print(f"[MOCK] {tid}")
                        time.sleep(ROTATION_TIME)
        
        logging.info(f"Success: {p_id}")
        return jsonify({"status": "success", "stage": "dispense_success"})
    except Exception as e:
        logging.error(f"Fatal Dispense Error {p_id}: {e}")
        return jsonify({"status": "error", "stage": "dispense_failed", "message": str(e)}), 500
    finally:
        dispense_lock.release()
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)
