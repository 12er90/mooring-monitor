import { SERVER_URL, logInfo, logError } from '../constants/config';

class ApiService {
  async generatePort() {
    try {
      logInfo('Generating new port data...');
      const response = await fetch(`${SERVER_URL}/api/port/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      logInfo('Port generated', data.port_name);
      return data;
    } catch (error) {
      logError('Failed to generate port', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getBerthsList() {
    try {
      logInfo('Fetching berths list...');
      const response = await fetch(`${SERVER_URL}/api/berths`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      logInfo('Berths fetched', { count: data.berths.length });
      return data;
    } catch (error) {
      logError('Failed to fetch berths', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async healthCheck() {
    try {
      const response = await fetch(`${SERVER_URL}/api/health`);
      const data = await response.json();
      return data;
    } catch (error) {
      logError('Health check failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export default new ApiService();
