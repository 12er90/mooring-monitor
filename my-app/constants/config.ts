// Configuration for the app
export const SERVER_IP = '172.20.10.3'; // Your computer's local WiFi IP
export const SERVER_URL = `http://${SERVER_IP}:5000`;

export function logDebug(message: string, data: any = null) {
  console.log(`[🐛 Debug] ${message}`, data || '');
}

export function logError(message: string, error: any = null) {
  console.error(`[❌ Error] ${message}`, error || '');
}

export function logInfo(message: string, data: any = null) {
  console.log(`[ℹ️ Info] ${message}`, data || '');
}
