# Critical State API Endpoints

These endpoints allow external services to trigger and stop critical events for mooring berths. When triggered, all connected clients listening to that berth will receive a critical alert with the specified evacuation direction.

## Base URL
```
http://localhost:5000
```

## Endpoints

### 1. Trigger Critical Event
**POST** `/api/berth/critical`

Triggers a critical event for a specific berth and broadcasts it to all connected clients.

#### Request Body
```json
{
  "berth_name": "Berth A",
  "danger_direction": "SE"
}
```

#### Parameters
- `berth_name` (string, required): The name of the berth to trigger critical event for
- `danger_direction` (string, optional): The direction clients should evacuate. Defaults to "N"
  - Valid values: `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`

#### Response (Success - 200)
```json
{
  "status": "success",
  "berth_name": "Berth A",
  "is_critical": true,
  "danger_direction": "SE",
  "clients_notified": 2
}
```

#### Response (Error - 400)
```json
{
  "error": "berth_name is required"
}
```

#### Response (Error - 404)
```json
{
  "error": "Berth A not found"
}
```

#### Example with cURL
```bash
curl -X POST http://localhost:5000/api/berth/critical \
  -H "Content-Type: application/json" \
  -d '{
    "berth_name": "Berth A",
    "danger_direction": "SE"
  }'
```

#### Example with Python
```python
import requests

url = "http://localhost:5000/api/berth/critical"
payload = {
    "berth_name": "Berth A",
    "danger_direction": "SE"
}

response = requests.post(url, json=payload)
print(response.json())
```

#### Example with JavaScript/Node.js
```javascript
fetch('http://localhost:5000/api/berth/critical', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    berth_name: 'Berth A',
    danger_direction: 'SE'
  })
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

### 2. Stop Critical Event
**POST** `/api/berth/critical/stop`

Stops the critical event for a specific berth and broadcasts a normal update (critical=false) to all connected clients.

#### Request Body
```json
{
  "berth_name": "Berth A"
}
```

#### Parameters
- `berth_name` (string, required): The name of the berth to stop critical event for

#### Response (Success - 200)
```json
{
  "status": "success",
  "berth_name": "Berth A",
  "is_critical": false,
  "clients_notified": 2
}
```

#### Response (Error - 400)
```json
{
  "error": "berth_name is required"
}
```

#### Response (Error - 404)
```json
{
  "error": "Berth A not found"
}
```

#### Example with cURL
```bash
curl -X POST http://localhost:5000/api/berth/critical/stop \
  -H "Content-Type: application/json" \
  -d '{
    "berth_name": "Berth A"
  }'
```

#### Example with Python
```python
import requests

url = "http://localhost:5000/api/berth/critical/stop"
payload = {
    "berth_name": "Berth A"
}

response = requests.post(url, json=payload)
print(response.json())
```

#### Example with JavaScript/Node.js
```javascript
fetch('http://localhost:5000/api/berth/critical/stop', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    berth_name: 'Berth A'
  })
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

## What Happens When Critical Event is Triggered

1. **API receives request** with berth name and danger direction
2. **Server validates** the berth exists
3. **Current berth data is retrieved** from the port worker
4. **Critical state is set** (`is_critical: true`) with the specified `danger_direction`
5. **All connected clients** listening to that berth receive the critical alert via WebSocket
6. **React Native app automatically**:
   - Displays the critical banner at the bottom
   - Shows the compass overlay
   - Displays the evacuation direction
   - Enables gyroscope tracking for orientation

## What Happens When Critical Event is Stopped

1. **API receives request** with berth name
2. **Server validates** the berth exists
3. **Current berth data is retrieved** from the port worker (normal, non-critical)
4. **Critical override is removed**
5. **All connected clients** listening to that berth receive the normal update via WebSocket
6. **React Native app automatically**:
   - Hides the compass overlay
   - Removes the critical banner
   - Returns to normal monitoring mode

---

## Complete Workflow Example

### Step 1: Generate Port (if not already done)
```bash
curl -X POST http://localhost:5000/api/port/generate \
  -H "Content-Type: application/json"
```

### Step 2: Get Berth List
```bash
curl http://localhost:5000/api/berths
```

### Step 3: Trigger Critical Event
```bash
curl -X POST http://localhost:5000/api/berth/critical \
  -H "Content-Type: application/json" \
  -d '{
    "berth_name": "Berth A",
    "danger_direction": "NE"
  }'
```

**Mobile app will immediately show**:
- Critical banner at bottom
- Full-screen compass overlay
- Arrow pointing northeast (NE)
- Gyroscope-enabled compass rotation

### Step 4: Stop Critical Event (after some time)
```bash
curl -X POST http://localhost:5000/api/berth/critical/stop \
  -H "Content-Type: application/json" \
  -d '{
    "berth_name": "Berth A"
  }'
```

**Mobile app will immediately**:
- Hide compass overlay
- Remove critical banner
- Return to normal monitoring

---

## Testing with Postman

1. Create a new POST request to `http://localhost:5000/api/berth/critical`
2. Set headers:
   - `Content-Type: application/json`
3. Set body (raw JSON):
   ```json
   {
     "berth_name": "Berth A",
     "danger_direction": "SE"
   }
   ```
4. Click Send
5. To stop, create another POST to `http://localhost:5000/api/berth/critical/stop` with:
   ```json
   {
     "berth_name": "Berth A"
   }
   ```

---

## Technical Details

### How Real-time Updates Work

1. **WebSocket Connection**: The React Native app maintains a persistent WebSocket connection to the server
2. **Berth Subscription**: When viewing a berth, the app calls `join_berth` to subscribe to updates for that berth
3. **Server Broadcasting**: When critical event is triggered via API, the server sends `berth_update` event to all subscribed clients
4. **Automatic UI Update**: The React Native app receives the update and automatically:
   - Updates state with new berth data
   - Checks if `is_critical` is true
   - Renders compass overlay if critical
   - Hides compass overlay if not critical

### Performance Considerations

- API calls are processed immediately and synchronously
- WebSocket broadcasts are sent to all listening clients in parallel
- No delay between API call and mobile app UI update (typically < 100ms)
- Multiple critical events can be triggered for different berths simultaneously
- Each berth maintains independent critical state

---

## Error Handling

### Common Errors

**400 Bad Request**
```json
{
  "error": "berth_name is required"
}
```
**Cause**: Missing `berth_name` parameter
**Solution**: Include `berth_name` in request body

**404 Not Found**
```json
{
  "error": "Berth A not found"
}
```
**Cause**: Specified berth doesn't exist in the port
**Solution**: Use `/api/berths` to get list of valid berth names

**404 No Port Data**
```json
{
  "error": "No port data available"
}
```
**Cause**: No port has been generated yet
**Solution**: Call `/api/port/generate` first to create a port

---

## Integration Examples

### Python Async Integration
```python
import asyncio
import aiohttp

async def trigger_critical():
    async with aiohttp.ClientSession() as session:
        url = "http://localhost:5000/api/berth/critical"
        payload = {
            "berth_name": "Berth A",
            "danger_direction": "S"
        }
        async with session.post(url, json=payload) as resp:
            return await resp.json()

asyncio.run(trigger_critical())
```

### Node.js with Express
```javascript
const express = require('express');
const axios = require('axios');
const app = express();

app.post('/trigger-critical', async (req, res) => {
  try {
    const response = await axios.post(
      'http://localhost:5000/api/berth/critical',
      {
        berth_name: req.body.berth_name,
        danger_direction: req.body.danger_direction
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

---

## Rate Limiting Considerations

Currently, there are **no rate limits** on these endpoints. If implementing in production, consider adding:

- Rate limiting per IP address
- Request throttling to prevent spam
- Authentication/authorization checks
- Audit logging for all critical events

---

## Future Enhancements

Potential additions to consider:

1. **Duration Parameter**: Auto-stop critical event after specified seconds
2. **Severity Levels**: Different severity levels with different colors/sounds
3. **Audio Alerts**: Optional alarm/siren sound trigger
4. **Analytics**: Track critical event triggers and duration
5. **Scheduled Events**: Schedule critical events for testing
6. **Multi-berth Critical**: Trigger critical for multiple berths at once
