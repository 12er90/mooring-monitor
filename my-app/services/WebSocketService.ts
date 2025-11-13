import io, { Socket } from 'socket.io-client';
import { SERVER_URL, logInfo, logError, logDebug } from '../constants/config';

interface Listeners {
  [key: string]: ((data: any) => void)[];
}

class WebSocketService {
  socket: Socket | null = null;
  listeners: Listeners = {};

  connect() {
    return new Promise<void>((resolve, reject) => {
      try {
        logInfo(`Connecting to WebSocket: ${SERVER_URL}`);

        this.socket = io(SERVER_URL, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 10,
        });

        this.socket.on('connect', () => {
          logInfo('✅ WebSocket connected');
          resolve();
        });

        this.socket.on('connect_error', (error: Error) => {
          logError('Connection error', error.message);
          reject(error);
        });

        this.socket.on('error', (error: any) => {
          logError('Socket error', error);
          this.emit('error', error);
        });

        this.socket.on('berth_data', (data: any) => {
          // Only log and process if there are actual listeners
          const hasGlobalListeners = this.listeners['berth_data']?.length > 0;
          const hasBerthListeners = this.listeners[`berth_data_${data.name}`]?.length > 0;
          
          if (hasGlobalListeners || hasBerthListeners) {
            logDebug(`Received berth_data ${data.name}`);
            // Emit to both global and berth-specific listeners
            this.notifyListeners('berth_data', data);
            this.notifyListeners(`berth_data_${data.name}`, data);
          }
        });

        this.socket.on('berth_update', (data: any) => {
          // Only log and process if there are actual listeners
          const hasGlobalListeners = this.listeners['berth_update']?.length > 0;
          const hasBerthListeners = this.listeners[`berth_update_${data.name}`]?.length > 0;
          
          if (hasGlobalListeners || hasBerthListeners) {
            logDebug(`Received berth_update ${data.name}`);
            // Emit to both global and berth-specific listeners
            this.notifyListeners('berth_update', data);
            this.notifyListeners(`berth_update_${data.name}`, data);
          }
        });

        setTimeout(() => {
          if (!this.socket?.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        logError('Connection error', error);
        reject(error);
      }
    });
  }

  disconnect() {
    if (this.socket) {
      logInfo('Disconnecting WebSocket');
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinBerth(berthName: string) {
    if (this.socket?.connected) {
      logInfo(`Joining berth: ${berthName}`);
      this.socket.emit('join_berth', { berth_name: berthName });
    } else {
      logError('Cannot join berth - socket not connected');
    }
  }

  leaveBerth(berthName?: string) {
    if (this.socket?.connected) {
      logInfo('Leaving berth');
      if (berthName) {
        this.socket.emit('leave_berth', { berth_name: berthName });
      } else {
        this.socket.emit('leave_berth');
      }
    }
  }

  requestUpdate() {
    if (this.socket?.connected) {
      this.socket.emit('request_update');
    }
  }

  // Emit to local listeners only
  on(event: string, callback: (data: any) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event: string, callback: (data: any) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event: string, data?: any) {
    // For socket events, send to server
    if (['join_berth', 'leave_berth', 'request_update'].includes(event)) {
      if (this.socket?.connected) {
        logDebug(`Emitting to server: ${event}`, data);
        this.socket.emit(event, data);
      } else {
        logError(`Cannot emit ${event} - socket not connected`);
      }
    } else {
      // For local events, emit to listeners
      this.notifyListeners(event, data);
    }
  }

  private notifyListeners(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logError(`Error in listener for ${event}`, error);
        }
      });
    }
  }

  isConnected() {
    return this.socket?.connected || false;
  }
}

export default new WebSocketService();
