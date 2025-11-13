import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gyroscope } from 'expo-sensors';
import { logInfo, logError } from '@/constants/config';
import WebSocketService from '@/services/WebSocketService';

interface Hook {
  id: string;
  name: string;
  tension: number | null;
}

interface Bollard {
  name: string;
  hooks: Hook[];
}

interface BerthData {
  name?: string;
  bollards: Bollard[];
  is_critical: boolean;
  danger_direction?: string;
  faulted_count: number;
}

export default function BerthMonitorScreen() {
  const { userName, berthName, portName } = useLocalSearchParams<{
    userName: string;
    berthName: string;
    portName: string;
  }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  
  const [berth, setBerth] = useState<BerthData | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortedBollards, setSortedBollards] = useState<Bollard[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationTicks, setSimulationTicks] = useState(0);
  const [dangerDirection, setDangerDirection] = useState<string>('N');
  const [deviceRotation, setDeviceRotation] = useState(0);

  // Keep track of the current listener function so we can remove it later
  const berthListenerRef = useRef<((data: BerthData) => void) | null>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBerthDataRef = useRef<BerthData | null>(null);
  const gyroscopeSubscriptionRef = useRef<any>(null);
  const accumulatedRotationRef = useRef(0);

  /**
   * Setup listener when component mounts or berth changes
   */
  useEffect(() => {
    if (!berthName) return;

    logInfo(`📍 Setting up listener for ${berthName}`);
    setupBerthListener();

    // Cleanup when component unmounts or berth changes
    return () => {
      logInfo(`🧹 Cleaning up listener for ${berthName}`);
      teardownBerthListener();
    };
  }, [berthName]);

  /**
   * Setup gyroscope for compass rotation tracking
   */
  useEffect(() => {
    if (!isSimulating) return;

    // Set gyroscope update interval
    Gyroscope.setUpdateInterval(100);

    // Subscribe to gyroscope updates
    gyroscopeSubscriptionRef.current = Gyroscope.addListener(({ x, y, z }) => {
      // z-axis rotation (left/right tilt) is what we need for horizontal rotation
      // Accumulate the rotation
      accumulatedRotationRef.current += z * 10; // Scale factor
      
      // Normalize to 0-360
      let rotation = accumulatedRotationRef.current % 360;
      if (rotation < 0) rotation += 360;
      
      setDeviceRotation(rotation);
    });

    return () => {
      if (gyroscopeSubscriptionRef.current) {
        gyroscopeSubscriptionRef.current.remove();
        gyroscopeSubscriptionRef.current = null;
      }
    };
  }, [isSimulating]);

  /**
   * Start listening to berth updates from backend
   */
  const setupBerthListener = async () => {
    try {
      setConnecting(true);
      setError(null);
      let dataReceived = false;

      // Create listener function
      const berthListener = (data: BerthData) => {
        // Skip if we're simulating
        if (isSimulating) return;

        logInfo(`✅ Received update for ${data.name}`);
        lastBerthDataRef.current = data;
        setBerth(data);
        updateSortedBollards(data);
        dataReceived = true;

        if (data.is_critical) {
          showCriticalAlert(data);
        }
      };

      // Store reference to remove later
      berthListenerRef.current = berthListener;

      // Subscribe to BERTH-SPECIFIC events ONLY (not global events)
      WebSocketService.on(`berth_data_${berthName}`, berthListener);
      WebSocketService.on(`berth_update_${berthName}`, berthListener);

      // Tell backend to start sending updates for this berth
      WebSocketService.emit('join_berth', { berth_name: berthName });
      logInfo(`🔌 Joined ${berthName}`);

      // Wait for first data with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!dataReceived) {
            reject(new Error('No data received from berth'));
          } else {
            resolve();
          }
        }, 5000);

        const checkData = setInterval(() => {
          if (dataReceived) {
            clearTimeout(timeout);
            clearInterval(checkData);
            resolve();
          }
        }, 100);
      });

      setConnecting(false);
    } catch (err) {
      logError('Failed to setup listener', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
      teardownBerthListener();
    }
  };

  /**
   * Stop listening to berth updates
   */
  const teardownBerthListener = () => {
    // ACTUALLY unsubscribe from the listener
    if (berthListenerRef.current) {
      WebSocketService.off(`berth_data_${berthName}`, berthListenerRef.current);
      WebSocketService.off(`berth_update_${berthName}`, berthListenerRef.current);
    }
    
    // Tell backend to stop sending
    if (berthName) {
      WebSocketService.emit('leave_berth', { berth_name: berthName });
      logInfo(`Left ${berthName}`);
    }

    berthListenerRef.current = null;
    logInfo(`👋 Unsubscribed from ${berthName}`);
  };

  /**
   * Start critical tension simulation for 15 seconds
   */
  const startSimulation = () => {
    if (!berth) {
      Alert.alert('Error', 'No berth data available');
      return;
    }

    logInfo('🚨 Starting critical tension simulation');
    setIsSimulating(true);
    setSimulationTicks(0);

    // Pick random direction
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    setDangerDirection(directions[Math.floor(Math.random() * directions.length)]);

    // Simulation interval: 15 ticks, each tick is 1 second
    simulationIntervalRef.current = setInterval(() => {
      setSimulationTicks(prev => {
        const nextTick = prev + 1;

        if (nextTick >= 15) {
          // End simulation after 15 ticks
          if (simulationIntervalRef.current) {
            clearInterval(simulationIntervalRef.current as any);
            simulationIntervalRef.current = null;
          }
          setIsSimulating(false);
          setSimulationTicks(0);
          logInfo('✅ Simulation complete, resuming normal data');
          return 0;
        }

        // Create mock data with random critical tension
        if (lastBerthDataRef.current && berth) {
          const mockBollards = berth.bollards.map(bollard => ({
            ...bollard,
            hooks: bollard.hooks.map(hook => ({
              ...hook,
              tension: Math.random() < 0.1 ? 90 : hook.tension, // 10% chance of 90 tension
            })),
          }));

          const mockData: BerthData = {
            ...berth,
            bollards: mockBollards,
            is_critical: true,
            danger_direction: dangerDirection,
          };

          setBerth(mockData);
          updateSortedBollards(mockData);
        }

        return nextTick;
      });
    }, 1000) as any;
  };

  /**
   * Sort bollards by max tension (highest first)
   */
  const updateSortedBollards = (data: BerthData) => {
    const sorted = [...(data.bollards || [])].sort((a, b) => {
      const tensionsA = a.hooks?.map(h => h.tension ?? 0) || [];
      const tensionsB = b.hooks?.map(h => h.tension ?? 0) || [];
      const maxA = tensionsA.length > 0 ? Math.max(...tensionsA) : 0;
      const maxB = tensionsB.length > 0 ? Math.max(...tensionsB) : 0;
      return maxB - maxA;
    });
    setSortedBollards(sorted);
  };

  /**
   * Navigate back to berth selection with cleanup
   */
  const handleBackPress = () => {
    teardownBerthListener();
    router.push({
      pathname: './berth-selection',
      params: { userName },
    });
  };

  /**
   * Show critical alert
   */
  const showCriticalAlert = (data: BerthData) => {
    const direction = data.danger_direction || 'UNKNOWN';
    Alert.alert(
      '🚨 CRITICAL ALERT',
      `Mooring tension exceeded safety limits!\n\nEvacuation direction: ${direction}`,
      [{ text: 'OK' }],
      { cancelable: false }
    );
  };

  /**
   * Get tension color based on value
   */
  const getTensionColor = (tension: number) => {
    if (tension >= 86) return '#dc2626';
    if (tension >= 70) return '#f97316';
    if (tension >= 50) return '#3b82f6';
    return '#10b981';
  };

  /**
   * Get tension status emoji
   */
  const getTensionStatus = (tension: number) => {
    if (tension >= 86) return '🔴 CRITICAL';
    if (tension >= 70) return '🟠 HIGH';
    if (tension >= 50) return '🔵 MEDIUM';
    return '🟢 NORMAL';
  };

  /**
   * Render a single hook
   */
  const renderHook = (hook: Hook) => {
    const tension = hook.tension ?? 0;
    return (
      <View key={hook.id} style={styles.hookRow}>
        <Text style={styles.hookName}>{hook.name}</Text>
        <View style={[styles.tensionValue, { borderLeftColor: getTensionColor(tension) }]}>
          <Text style={styles.tensionNumber}>{tension.toFixed(1)}</Text>
        </View>
        <Text style={{ color: getTensionColor(tension), fontWeight: 'bold' }}>
          {getTensionStatus(tension)}
        </Text>
      </View>
    );
  };

  /**
   * Render a bollard card
   */
  const renderBollard = ({ item: bollard }: { item: Bollard }) => {
    const tensions = bollard.hooks?.map(h => h.tension ?? 0) || [];
    const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;

    return (
      <View style={styles.bollardCard}>
        <View style={styles.bollardHeader}>
          <Text style={styles.bollardName}>{bollard.name}</Text>
          <View style={[styles.maxTensionBadge, { backgroundColor: getTensionColor(maxTension) }]}>
            <Text style={styles.badgeText}>Max: {maxTension.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.hooksContainer}>
          {bollard.hooks && bollard.hooks.length > 0
            ? bollard.hooks.map(hook => {
                const tension = hook.tension ?? 0;
                return (
                  <View key={hook.id} style={styles.hookRow}>
                    <Text style={styles.hookName}>{hook.name}</Text>
                    <View style={[styles.tensionValue, { borderLeftColor: getTensionColor(tension) }]}>
                      <Text style={styles.tensionNumber}>{tension.toFixed(1)}</Text>
                    </View>
                    <Text style={{ color: getTensionColor(tension), fontWeight: 'bold' }}>
                      {getTensionStatus(tension)}
                    </Text>
                  </View>
                );
              })
            : <Text key="no-hooks" style={styles.noHooksText}>No hook data</Text>}
        </View>
      </View>
    );
  };

  // Loading state
  if (connecting) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Connecting to {berthName}...</Text>
      </View>
    );
  }

  // Error state
  if (error || !berth) {
    return (
      <View style={styles.centerContainer}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorText}>❌ {error || 'Connection lost'}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setError(null);
            setupBerthListener();
          }}
        >
          <Text style={styles.retryButtonText}>Reconnect</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Calculate stats
  const totalBollards = sortedBollards.length;
  const criticalCount = sortedBollards.filter(b => {
    const tensions = b.hooks?.map(h => h.tension ?? 0) || [];
    const maxTension = tensions.length > 0 ? Math.max(...tensions) : 0;
    return maxTension >= 86;
  }).length;
  const faultedCount = berth.faulted_count || 0;

  // Main view
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{berthName}</Text>
        <Text style={styles.headerSubtitle}>{portName}</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statsScroll}
        >
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Bollards</Text>
            <Text style={styles.statValue}>{totalBollards}</Text>
          </View>
          <View style={[styles.statCard, styles.criticalStat]}>
            <Text style={styles.statLabel}>Critical</Text>
            <Text style={styles.statValue}>{criticalCount}</Text>
          </View>
          <View style={[styles.statCard, styles.faultedStat]}>
            <Text style={styles.statLabel}>Faulted</Text>
            <Text style={styles.statValue}>{faultedCount}</Text>
          </View>
        </ScrollView>
      </View>

      {/* Bollard list */}
      {sortedBollards.length > 0 ? (
        <FlatList
          data={sortedBollards}
          renderItem={renderBollard}
          keyExtractor={item => item.name}
          contentContainerStyle={styles.listContent}
          scrollEnabled={true}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No bollard data available</Text>
        </View>
      )}

      {/* Critical banner */}
      {berth.is_critical && (
        <View style={styles.criticalBanner}>
          <Text style={styles.criticalBannerText}>🚨 CRITICAL STATE</Text>
        </View>
      )}

      {/* Simulation mode - show compass */}
      {isSimulating && (
        <View style={[styles.compassOverlay, { width, height }]}>
          <View
            style={[
              styles.compassOuter,
              {
                transform: [{ rotate: `${deviceRotation}deg` }],
              },
            ]}
          >
            {/* Cardinal directions */}
            <Text style={[styles.compassDirection, styles.compassN]}>N</Text>
            <Text style={[styles.compassDirection, styles.compassE]}>E</Text>
            <Text style={[styles.compassDirection, styles.compassS]}>S</Text>
            <Text style={[styles.compassDirection, styles.compassW]}>W</Text>

            {/* Center circle with arrow */}
            <View style={styles.compassCenter}>
              <Text
                style={[
                  styles.compassArrow,
                  {
                    transform: [
                      {
                        rotate:
                          dangerDirection === 'N'
                            ? '0deg'
                            : dangerDirection === 'NE'
                            ? '45deg'
                            : dangerDirection === 'E'
                            ? '90deg'
                            : dangerDirection === 'SE'
                            ? '135deg'
                            : dangerDirection === 'S'
                            ? '180deg'
                            : dangerDirection === 'SW'
                            ? '225deg'
                            : dangerDirection === 'W'
                            ? '270deg'
                            : '315deg',
                      },
                    ],
                  },
                ]}
              >
                ↑
              </Text>
            </View>
          </View>

          <View style={styles.compassBottomBar}>
            <Text style={styles.directionText}>
              RUN {dangerDirection} - {simulationTicks}/15s
            </Text>
            <TouchableOpacity
              style={styles.simulateButton}
              onPress={() => {
                if (simulationIntervalRef.current) {
                  clearInterval(simulationIntervalRef.current as any);
                  simulationIntervalRef.current = null;
                }
                setIsSimulating(false);
                setSimulationTicks(0);
              }}
            >
              <Text style={styles.simulateButtonText}>Stop Simulation</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Start simulation button */}
      {!isSimulating && (
        <TouchableOpacity
          style={styles.simulateButton}
          onPress={startSimulation}
        >
          <Text style={styles.simulateButtonText}>Start Critical Test</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 16,
    marginTop: 12,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
    marginBottom: 16,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  header: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 12,
  },
  statsScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  statCard: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  criticalStat: {
    borderColor: '#dc2626',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
  },
  faultedStat: {
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  statLabel: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  bollardCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  bollardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bollardName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  maxTensionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  hooksContainer: {
    gap: 8,
  },
  hookRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    borderRadius: 6,
  },
  hookName: {
    fontSize: 14,
    color: '#cbd5e1',
    flex: 1,
  },
  tensionValue: {
    borderLeftWidth: 4,
    paddingLeft: 8,
    marginHorizontal: 8,
  },
  tensionNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  noHooksText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#64748b',
  },
  criticalBanner: {
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  criticalBannerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  compassContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#1e293b',
    marginVertical: 12,
    borderRadius: 12,
    marginHorizontal: 16,
  },
  compassOuter: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#0f172a',
    borderWidth: 3,
    borderColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: 16,
  },
  compassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.98)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  compassDirection: {
    position: 'absolute',
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  compassN: {
    top: 40,
  },
  compassE: {
    right: 40,
  },
  compassS: {
    bottom: 40,
  },
  compassW: {
    left: 40,
  },
  compassCenter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassArrow: {
    fontSize: 64,
    color: '#fff',
    fontWeight: 'bold',
  },
  compassBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  directionText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#dc2626',
    marginBottom: 12,
  },
  simulateButton: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    alignItems: 'center',
  },
  simulateButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
