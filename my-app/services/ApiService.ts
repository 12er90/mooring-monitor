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

  /**
   * Trigger a critical event for a specific berth
   * This endpoint should be called by external services to simulate or trigger critical mooring conditions
   * @param berthName - The name of the berth
   * @param dangerDirection - The direction to evacuate (N, NE, E, SE, S, SW, W, NW)
   * @returns The response from the server
   */
  async triggerCriticalEvent(berthName: string, dangerDirection: string = 'N') {
    try {
      logInfo(`Triggering critical event for berth: ${berthName}`);
      const response = await fetch(`${SERVER_URL}/api/berth/critical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          berth_name: berthName,
          danger_direction: dangerDirection,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      logInfo(`Critical event triggered for ${berthName}`);
      return data;
    } catch (error) {
      logError('Failed to trigger critical event', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export default new ApiService();
