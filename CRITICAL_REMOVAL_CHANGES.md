# Critical Simulation Removal - Changes Summary

## Overview
Removed the internal critical tension simulation feature from the React Native application and replaced it with an external API route that can be called to trigger critical events from external services.

## Changes Made

### 1. **berth-monitor.tsx** - Component Cleanup
Removed all simulation-related code from the berth monitoring screen:

#### Removed State Variables:
- `isSimulating` - boolean flag for simulation mode
- `simulationTicks` - counter for simulation duration
- `dangerDirection` - random danger direction
- `deviceRotation` - gyroscope device rotation

#### Removed Refs:
- `simulationIntervalRef` - interval for simulation updates
- `lastBerthDataRef` - backup of berth data during simulation
- `gyroscopeSubscriptionRef` - gyroscope sensor subscription
- `accumulatedRotationRef` - accumulated gyroscope rotation

#### Removed Hooks:
- Gyroscope effect hook that tracked device rotation

#### Removed Functions:
- `startSimulation()` - Function that started the 15-second critical simulation

#### Removed UI Components:
- Compass overlay display with directional indicators (N, E, S, W)
- Compass arrow indicating evacuation direction
- "Start Critical Test" and "Stop Simulation" buttons
- Compass bottom bar showing countdown and direction

#### Removed Styles:
- `compassContainer` - Container styling for compass
- `compassOuter` - Outer compass circle styling
- `compassOverlay` - Full-screen overlay styling
- `compassDirection` - Cardinal direction text styling (N, E, S, W)
- `compassCenter` - Center circle with arrow styling
- `compassArrow` - Arrow icon styling
- `compassBottomBar` - Bottom info bar styling
- `directionText` - Direction display text styling
- `simulateButton` - Button styling
- `simulateButtonText` - Button text styling

#### Updated Imports:
- ❌ Removed: `useWindowDimensions` from react-native
- ❌ Removed: `Gyroscope` from expo-sensors
- ✅ Kept: All necessary imports for real-time data monitoring

#### Listener Updates:
- Updated berthListener to remove simulation check
- Now directly receives and processes critical events from backend

### 2. **ApiService.ts** - New External Trigger Route
Added a new method to trigger critical events from external services:

```typescript
/**
 * Trigger a critical event for a specific berth
 * This endpoint should be called by external services to simulate or trigger critical mooring conditions
 * @param berthName - The name of the berth
 * @param dangerDirection - The direction to evacuate (N, NE, E, SE, S, SW, W, NW)
 * @returns The response from the server
 */
async triggerCriticalEvent(berthName: string, dangerDirection: string = 'N') {
  // Makes POST request to /api/berth/critical
  // Sends: { berth_name, danger_direction }
}
```

## How to Use the External API

To trigger a critical event from an external service, call:

```javascript
import ApiService from '@/services/ApiService';

// Trigger critical event
await ApiService.triggerCriticalEvent('Berth A', 'SE');
```

Or make a direct HTTP POST request:

```bash
POST /api/berth/critical
Content-Type: application/json

{
  "berth_name": "Berth A",
  "danger_direction": "SE"
}
```

**Supported Directions:** N, NE, E, SE, S, SW, W, NW

## Backend Implementation Required

The backend (websocket_server.py) needs to implement the `/api/berth/critical` endpoint that:

1. Receives the berth name and danger direction
2. Updates the berth data with `is_critical: true` and the specified `danger_direction`
3. Emits this critical data to all connected clients via WebSocket
4. The app will automatically receive this data and display the critical alert

## Benefits

✅ **Decoupled Design** - Critical events are no longer hardcoded in the app
✅ **External Control** - Any external service can trigger critical scenarios
✅ **Cleaner Code** - Removed ~200 lines of simulation logic
✅ **Real-time Updates** - Uses existing WebSocket infrastructure
✅ **No Dependencies** - Removed Gyroscope and useWindowDimensions dependencies
✅ **Alert Functionality Preserved** - Critical alerts still display when data is received

## Testing

To test the implementation:

1. Start the app and navigate to a berth
2. From an external service (curl, Postman, etc.), call:
   ```bash
   curl -X POST http://localhost:5000/api/berth/critical \
     -H "Content-Type: application/json" \
     -d '{"berth_name": "Berth A", "danger_direction": "NE"}'
   ```
3. The app should receive the critical event via WebSocket and display the alert
