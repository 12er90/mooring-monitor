from flask import Flask, jsonify, request
from flask_socketio import SocketIO, emit
from mooring_data_generator.builder import build_random_port
import importlib
import mooring_data_generator.builder as builder_module
from threading import Thread
import time
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = 'mooring-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Store port workers and active connections
port_worker = None
active_berth_listeners = {}  # Maps berth_name -> set of client SIDs listening to that berth
update_thread = None
running = False
simulated_critical_berths = {}  # Maps berth_name -> {'end_time': timestamp, 'hook_id': id}
simulated_warning_berths = {}  # Maps berth_name -> {'end_time': timestamp, 'hook_id': id, 'bollard_name': str, 'hook_name': str}


def reset_generator_state():
    """Reset the mooring data generator to allow unlimited generations"""
    importlib.reload(builder_module)


def calculate_danger_direction(berth_data):
    """Calculate the direction crew should run based on tension patterns"""
    critical_positions = []
    
    for bollard_idx, bollard in enumerate(berth_data['bollards']):
        for hook_idx, hook in enumerate(bollard['hooks']):
            if hook['tension'] and hook['tension'] >= 86:
                position = bollard_idx / len(berth_data['bollards']) if berth_data['bollards'] else 0.5
                critical_positions.append(position)
    
    if not critical_positions:
        return 0
    
    avg_position = sum(critical_positions) / len(critical_positions)
    
    if avg_position < 0.5:
        return 180 + random.randint(-45, 45)
    else:
        angle = random.randint(-45, 45)
        return angle if angle >= 0 else 360 + angle


def get_berth_data(berth):
    """Convert berth object to dictionary"""
    critical_hooks = []
    warning_hooks = []
    max_tension = 0
    total_tension = 0
    faulted_count = 0
    
    for bollard in berth.bollards:
        for hook in bollard.hooks:
            if hook.faulted:
                faulted_count += 1
            if hook.tension:
                total_tension += hook.tension
                if hook.tension > max_tension:
                    max_tension = hook.tension
                if hook.tension >= 86:
                    critical_hooks.append({
                        'bollard': bollard.name,
                        'hook': hook.name,
                        'tension': hook.tension
                    })
                elif hook.tension >= 70:  # Warning range: 70-85
                    warning_hooks.append({
                        'bollard': bollard.name,
                        'hook': hook.name,
                        'tension': hook.tension,
                        'attached_line': hook.attached_line
                    })
    
    berth_data = {
        'name': berth.name,
        'bollard_count': berth.bollard_count,
        'hook_count': berth.hook_count,
        'ship': {
            'name': berth.ship.name,
            'vessel_id': berth.ship.vessel_id
        } if berth.ship else None,
        'radars': [
            {
                'name': radar.name,
                'ship_distance': radar.ship_distance,
                'distance_change': radar.distance_change,
                'status': radar.distance_status
            }
            for radar in berth.radars
        ],
        'bollards': [
            {
                'name': bollard.name,
                'hooks': [
                    {
                        'name': hook.name,
                        'tension': hook.tension,
                        'faulted': hook.faulted,
                        'attached_line': hook.attached_line
                    }
                    for hook in bollard.hooks
                ]
            }
            for bollard in berth.bollards
        ],
        'statistics': {
            'max_tension': max_tension,
            'total_tension': total_tension,
            'critical_count': len(critical_hooks),
            'warning_count': len(warning_hooks),
            'faulted_count': faulted_count,
            'critical_hooks': critical_hooks,
            'warning_hooks': warning_hooks
        }
    }
    
    if critical_hooks:
        berth_data['danger_direction'] = calculate_danger_direction(berth_data)
        berth_data['is_critical'] = True
        berth_data['is_warning'] = False
        berth_data['critical_hooks'] = critical_hooks
    elif warning_hooks:
        berth_data['is_critical'] = False
        berth_data['is_warning'] = True
        berth_data['warning_hooks'] = warning_hooks
    else:
        berth_data['danger_direction'] = 0
        berth_data['is_critical'] = False
        berth_data['is_warning'] = False
    
    return berth_data


def update_port_data():
    """Background thread to send updates ONLY to listening clients"""
    global port_worker, running, simulated_critical_berths, simulated_warning_berths
    
    while running:
        if port_worker:
            try:
                current_time = time.time()
                
                # Check if any CRITICAL simulations have expired and reset them
                for berth_name in list(simulated_critical_berths.keys()):
                    sim_data = simulated_critical_berths[berth_name]
                    time_remaining = sim_data['end_time'] - current_time
                    
                    if current_time >= sim_data['end_time']:
                        # Find and reset the hook
                        berth = next((b for b in port_worker.data.berths if b.name == berth_name), None)
                        if berth:
                            hook_parts = sim_data['hook_id'].split('_')
                            bollard = next((b for b in berth.bollards if b.name == hook_parts[0]), None)
                            if bollard:
                                hook = next((h for h in bollard.hooks if h.name == hook_parts[1]), None)
                                if hook:
                                    hook.tension = sim_data['original_tension']
                                    print(f"🎬 CRITICAL SIMULATION ENDED for {berth_name} - tension reset to {sim_data['original_tension']}")
                        
                        # Remove from tracking
                        del simulated_critical_berths[berth_name]
                    else:
                        print(f"🚨 {berth_name} CRITICAL simulation active - {time_remaining:.1f}s remaining - SKIPPING port_worker.update()")
                
                # Check if any WARNING simulations have expired and reset them
                for berth_name in list(simulated_warning_berths.keys()):
                    sim_data = simulated_warning_berths[berth_name]
                    time_remaining = sim_data['end_time'] - current_time
                    
                    if current_time >= sim_data['end_time']:
                        # Find and reset the hook
                        berth = next((b for b in port_worker.data.berths if b.name == berth_name), None)
                        if berth:
                            hook_parts = sim_data['hook_id'].split('_')
                            bollard = next((b for b in berth.bollards if b.name == hook_parts[0]), None)
                            if bollard:
                                hook = next((h for h in bollard.hooks if h.name == hook_parts[1]), None)
                                if hook:
                                    hook.tension = sim_data['original_tension']
                                    print(f"⚠️  WARNING SIMULATION ENDED for {berth_name} - tension reset to {sim_data['original_tension']}")
                        
                        # Remove from tracking
                        del simulated_warning_berths[berth_name]
                    else:
                        print(f"⚠️  {berth_name} WARNING simulation active - {time_remaining:.1f}s remaining - SKIPPING port_worker.update()")
                
                # CRUCIAL: Only update port data if NO simulations (critical or warning) are active
                # This prevents port_worker from overwriting simulated hook tensions
                if not simulated_critical_berths and not simulated_warning_berths:
                    port_worker.update()
                    print(f"✅ port_worker.update() executed (no active simulations)")
                    
                    # CRUCIAL: Send updates ONLY to clients when NO simulations are active
                    # This freezes all WebSocket updates during simulation periods
                    port_data = port_worker.data
                    for berth_name, client_sids in list(active_berth_listeners.items()):
                        berth = next((b for b in port_data.berths if b.name == berth_name), None)
                        if berth:
                            berth_data = get_berth_data(berth)
                            # Send only to clients in this berth's listener set
                            for sid in list(client_sids):
                                try:
                                    # Emit berth update
                                    socketio.emit('berth_update', berth_data, to=sid)
                                except Exception as e:
                                    print(f"Error sending to {sid}: {e}")
                else:
                    active_sims = len(simulated_critical_berths) + len(simulated_warning_berths)
                    print(f"⏸️  FROZEN - port_worker.update() SKIPPED + WebSocket updates BLOCKED ({active_sims} active simulations)")
            except Exception as e:
                print(f"Error updating port data: {e}")
        
        time.sleep(2)


@app.route('/api/health')
def health_check():
    return jsonify({"status": "healthy", "port_active": port_worker is not None})


@app.route('/api/port/generate', methods=['POST'])
def generate_port():
    global port_worker, running, update_thread
    
    try:
        reset_generator_state()
        from mooring_data_generator.builder import build_random_port
        port_worker = build_random_port()
        
        if not running:
            running = True
            update_thread = Thread(target=update_port_data, daemon=True)
            update_thread.start()
        
        return jsonify({
            "status": "success",
            "port_name": port_worker.data.name,
            "berth_count": len(port_worker.data.berths)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/berths', methods=['GET'])
def get_berths_list():
    if not port_worker:
        return jsonify({"error": "No port data available"}), 404
    
    berths = [
        {
            'name': berth.name,
            'has_ship': berth.ship is not None,
            'ship_name': berth.ship.name if berth.ship else None
        }
        for berth in port_worker.data.berths
    ]
    
    return jsonify({
        'port_name': port_worker.data.name,
        'berths': berths
    })


@app.route('/api/berth/simulate-critical', methods=['POST'])
def simulate_critical_event():
    """
    Simulate a critical event for 15 seconds by setting a random hook's tension to >90.
    This endpoint sets high tension on a random hook which triggers is_critical automatically.
    
    Request body:
    {
        "berth_name": "Berth A"
    }
    """
    global port_worker, simulated_critical_berths
    
    try:
        data = request.get_json()
        berth_name = data.get('berth_name')
        
        if not berth_name:
            return jsonify({"error": "berth_name is required"}), 400
        
        if not port_worker:
            return jsonify({"error": "No port data available"}), 404
        
        # Verify berth exists
        berth = next((b for b in port_worker.data.berths if b.name == berth_name), None)
        if not berth:
            return jsonify({"error": f"Berth {berth_name} not found"}), 404
        
        # Get a random hook from the berth
        if not berth.bollards or not berth.bollards[0].hooks:
            return jsonify({"error": "Berth has no hooks"}), 400
        
        random_bollard = random.choice(berth.bollards)
        random_hook = random.choice(random_bollard.hooks)
        
        # Store original tension
        original_tension = random_hook.tension
        
        # Set hook tension to critical (>90)
        critical_tension = 95.0
        random_hook.tension = critical_tension
        
        # Set end time (15 seconds from now)
        end_time = time.time() + 15
        simulated_critical_berths[berth_name] = {
            'end_time': end_time,
            'hook_id': f"{random_bollard.name}_{random_hook.name}",
            'original_tension': original_tension
        }
        
        print(f"🎬 CRITICAL SIMULATION STARTED for {berth_name}")
        print(f"   Hook: {random_bollard.name} - {random_hook.name}")
        print(f"   Tension: {critical_tension} (will reset in 15 seconds)")
        
        # Send immediate update to all clients listening to this berth
        berth_data = get_berth_data(berth)
        if berth_name in active_berth_listeners:
            for sid in active_berth_listeners[berth_name]:
                socketio.emit('berth_update', berth_data, to=sid)
                print(f"  📤 Sent critical update to client {sid}")
        
        return jsonify({
            "status": "success",
            "berth_name": berth_name,
            "hook": f"{random_bollard.name}_{random_hook.name}",
            "tension": critical_tension,
            "duration_seconds": 15,
            "clients_notified": len(active_berth_listeners.get(berth_name, set()))
        })
    
    except Exception as e:
        print(f"❌ Error simulating critical event: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/berth/simulate-warning', methods=['POST'])
def simulate_warning_event():
    """
    Simulate a warning event for 15 seconds by setting a random hook's tension to 70-85.
    This triggers is_warning state and shows which bollard and hook need adjustment.
    
    Request body:
    {
        "berth_name": "Berth A"
    }
    """
    global port_worker, simulated_warning_berths
    
    try:
        data = request.get_json()
        berth_name = data.get('berth_name')
        
        if not berth_name:
            return jsonify({"error": "berth_name is required"}), 400
        
        if not port_worker:
            return jsonify({"error": "No port data available"}), 404
        
        # Verify berth exists
        berth = next((b for b in port_worker.data.berths if b.name == berth_name), None)
        if not berth:
            return jsonify({"error": f"Berth {berth_name} not found"}), 404
        
        # Get a random hook from the berth
        if not berth.bollards or not berth.bollards[0].hooks:
            return jsonify({"error": "Berth has no hooks"}), 400
        
        random_bollard = random.choice(berth.bollards)
        random_hook = random.choice(random_bollard.hooks)
        
        # Store original tension
        original_tension = random_hook.tension
        
        # Set hook tension to warning (70-85)
        warning_tension = random.uniform(70, 85)
        random_hook.tension = warning_tension
        
        # Set end time (15 seconds from now)
        end_time = time.time() + 15
        simulated_warning_berths[berth_name] = {
            'end_time': end_time,
            'hook_id': f"{random_bollard.name}_{random_hook.name}",
            'original_tension': original_tension,
            'bollard_name': random_bollard.name,
            'hook_name': random_hook.name
        }
        
        print(f"⚠️  WARNING SIMULATION STARTED for {berth_name}")
        print(f"   Bollard: {random_bollard.name}")
        print(f"   Hook: {random_hook.name}")
        print(f"   Tension: {warning_tension:.2f} (will reset in 15 seconds)")
        
        # Send immediate update to all clients listening to this berth
        berth_data = get_berth_data(berth)
        # Add warning info to the berth data
        berth_data['is_warning'] = True
        berth_data['warning_bollard'] = random_bollard.name
        berth_data['warning_hook'] = random_hook.name
        berth_data['warning_tension'] = warning_tension
        
        if berth_name in active_berth_listeners:
            for sid in active_berth_listeners[berth_name]:
                socketio.emit('berth_update', berth_data, to=sid)
                print(f"  📤 Sent warning update to client {sid}")
        
        return jsonify({
            "status": "success",
            "berth_name": berth_name,
            "bollard": random_bollard.name,
            "hook": random_hook.name,
            "tension": warning_tension,
            "duration_seconds": 15,
            "clients_notified": len(active_berth_listeners.get(berth_name, set()))
        })
    
    except Exception as e:
        print(f"❌ Error simulating warning event: {e}")
        return jsonify({"error": str(e)}), 500


@socketio.on('connect')
def handle_connect():
    print(f"✅ Client connected: {request.sid}")
    emit('connected', {'message': 'Connected to mooring server'})


@socketio.on('disconnect')
def handle_disconnect():
    print(f"❌ Client disconnected: {request.sid}")
    # Remove this client from ALL berth listeners
    for berth_name in list(active_berth_listeners.keys()):
        if request.sid in active_berth_listeners[berth_name]:
            active_berth_listeners[berth_name].discard(request.sid)
            print(f"  Removed from {berth_name}, listeners left: {len(active_berth_listeners[berth_name])}")
        if not active_berth_listeners[berth_name]:
            del active_berth_listeners[berth_name]


@socketio.on('join_berth')
def handle_join_berth(data):
    berth_name = data.get('berth_name')
    print(f"📍 Client {request.sid} wants to join {berth_name}")
    
    if not port_worker:
        emit('error', {'message': 'No port data available'})
        return
    
    berth = next((b for b in port_worker.data.berths if b.name == berth_name), None)
    if not berth:
        emit('error', {'message': f'Berth {berth_name} not found'})
        return
    
    # Remove from any previous berth listeners
    for bn in list(active_berth_listeners.keys()):
        if request.sid in active_berth_listeners[bn]:
            active_berth_listeners[bn].discard(request.sid)
            print(f"  Removed from previous berth {bn}")
    
    # Add to this berth's listeners
    if berth_name not in active_berth_listeners:
        active_berth_listeners[berth_name] = set()
    active_berth_listeners[berth_name].add(request.sid)
    print(f"✅ Client {request.sid} now listening to {berth_name}. Listeners: {active_berth_listeners[berth_name]}")
    
    # Send initial data
    berth_data = get_berth_data(berth)
    emit('berth_data', berth_data)


@socketio.on('leave_berth')
def handle_leave_berth(data):
    berth_name = data.get('berth_name')
    print(f"👋 Client {request.sid} leaving {berth_name}")
    
    if berth_name in active_berth_listeners:
        active_berth_listeners[berth_name].discard(request.sid)
        print(f"  Listeners left: {active_berth_listeners[berth_name]}")
        if not active_berth_listeners[berth_name]:
            del active_berth_listeners[berth_name]
            print(f"  No listeners for {berth_name}, removed")


if __name__ == '__main__':
    print("🚀 Starting Mooring WebSocket Server...")
    print("📡 Server running on http://0.0.0.0:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
