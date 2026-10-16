import requests
import json
import os

CONFIG_FILE = "config/config.json"

def load_config():
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def test_mdblist():
    config = load_config()
    api_key = config.get('mdblist_api_key')
    
    if not api_key:
        print("Error: 'mdblist_api_key' not found in config.json")
        print("Please add 'mdblist_api_key': 'YOUR_KEY_HERE' to config.json")
        return

    # Basic test to get users lists
    # Pass the key via params so it never appears in anything we print.
    lists_endpoint = "https://mdblist.com/api/lists/user/"
    print(f"Testing MDBList User Lists Endpoint: {lists_endpoint}")
    
    try:
        resp = requests.get(lists_endpoint, params={"apikey": api_key}, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"Success! Found {len(data)} lists.")
        else:
            print("Error: request failed (response body omitted; it may echo the API key)")
    except Exception as e:
        print(f"Exception: {e}")

    # Top Lists test
    toplists_endpoint = "https://mdblist.com/api/toplists/"
    print(f"\nTesting MDBList Top Lists Endpoint: {toplists_endpoint}")
    try:
        resp = requests.get(toplists_endpoint, params={"apikey": api_key}, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"Success! Found {len(data)} top lists.")
        else:
            print("Error: request failed (response body omitted; it may echo the API key)")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    if not os.path.exists(CONFIG_FILE):
        print(f"{CONFIG_FILE} not found. Running from correct directory?")
    else:
        test_mdblist()
