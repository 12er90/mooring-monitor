import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gyroscope } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
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
  is_warning?: boolean;
  danger_direction?: string;
  warning_hooks?: Array<{bollard: string; hook: string; tension: number; attached_line?: string | null}>;
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
  const [deviceRotation, setDeviceRotation] = useState(0);
  const [showingCriticalAlert, setShowingCriticalAlert] = useState(false);
  const [showingWarningAlert, setShowingWarningAlert] = useState(false);

  // Keep track of the current listener function so we can remove it later
  const berthListenerRef = useRef<((data: BerthData) => void) | null>(null);
  const gyroscopeSubscriptionRef = useRef<any>(null);
  const accumulatedRotationRef = useRef(0);
  const criticalVibrationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const criticalSoundRef = useRef<Audio.Sound | null>(null);

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
   * Handle critical state changes (show/hide modal based on tension)
   */
  useEffect(() => {
    if (!berth) return;

    // When tension exceeds 86 (critical), show the alert modal
    if (berth.is_critical && !showingCriticalAlert) {
      logInfo(`🚨 Critical state detected for ${berth.name}`);
      setShowingCriticalAlert(true);
      
      // Start continuous MAXIMUM vibration during critical state
      if (criticalVibrationRef.current) {
        clearInterval(criticalVibrationRef.current);
      }
      
      // Setup Audio for continuous alarm sound
      const setupCriticalAlert = async () => {
        try {
          // Set audio mode to allow sound even in silent mode
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: false,
            staysActiveInBackground: true,
          });

          // Try to load a critical alarm sound from assets
          // If file doesn't exist, use system notification sound
          try {
            const { sound } = await Audio.Sound.createAsync(
              require('@/assets/sounds/alert.mp3'),
              { shouldPlay: false, isLooping: true }
            );
            criticalSoundRef.current = sound;
            await sound.setVolumeAsync(1.0);
            await sound.playAsync();
            logInfo('Critical siren sound started - looping');
          } catch (soundErr) {
            // Fallback: create alarm using rapid beeps with the notification system
            logInfo('Using system notification for critical alarm');
            const playAlarmBeeps = async () => {
              for (let i = 0; i < 10; i++) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                await new Promise(resolve => setTimeout(resolve, 300));
              }
            };
            playAlarmBeeps();
          }
        } catch (err) {
          logError('Failed to setup critical alert', err);
        }
      };
      
      setupCriticalAlert();
      
      // Trigger initial vibration burst
      const triggerMaxVibration = async () => {
        for (let i = 0; i < 5; i++) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          Haptics.selectionAsync();
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      
      triggerMaxVibration();
      
      criticalVibrationRef.current = setInterval(() => {
        // CONTINUOUS MAXIMUM heavy vibration pattern
        const vibrationSequence = async () => {
          for (let i = 0; i < 3; i++) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            Haptics.selectionAsync();
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        };
        vibrationSequence();
      }, 300); // Every 300ms for more frequent intense feedback
      
    } else if (!berth.is_critical && showingCriticalAlert) {
      logInfo(`✅ Critical state cleared for ${berth.name}`);
      setShowingCriticalAlert(false);
      
      // Stop vibration
      if (criticalVibrationRef.current) {
        clearInterval(criticalVibrationRef.current);
        criticalVibrationRef.current = null;
      }
      
      // Stop sound safely
      if (criticalSoundRef.current) {
        criticalSoundRef.current.stopAsync()
          .catch((err) => logError('Error stopping sound', err))
          .finally(async () => {
            try {
              await criticalSoundRef.current?.unloadAsync();
              criticalSoundRef.current = null;
              logInfo('Critical alarm sound stopped');
            } catch (err) {
              logError('Error unloading sound', err);
              criticalSoundRef.current = null;
            }
          });
      }
    }
    
    return () => {
      // Cleanup on unmount
      if (criticalVibrationRef.current) {
        clearInterval(criticalVibrationRef.current);
      }
      if (criticalSoundRef.current) {
        criticalSoundRef.current.stopAsync()
          .catch((err) => logError('Error stopping sound on unmount', err))
          .finally(async () => {
            try {
              await criticalSoundRef.current?.unloadAsync();
            } catch (err) {
              logError('Error unloading sound on unmount', err);
            }
          });
      }
    };
  }, [berth?.is_critical]);

  /**
   * Handle warning state changes (show/hide warning modal based on tension 70-85)
   */
  useEffect(() => {
    if (!berth) return;

    // When tension is 70-85 (warning), show the warning modal
    if (berth.is_warning && !showingWarningAlert) {
      logInfo(`⚠️ Warning state detected for ${berth.name}`);
      setShowingWarningAlert(true);
      
      // Trigger warning pattern: 2 INTENSE vibrations + 2 sounds at MAX volume
      const triggerWarningPattern = async () => {
        try {
          // Set audio mode
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: false,
          });

          // First INTENSE vibration burst
          for (let i = 0; i < 3; i++) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            Haptics.selectionAsync();
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          await new Promise(resolve => setTimeout(resolve, 400));
          
          // First warning sound (with fallback)
          try {
            const { sound: sound1 } = await Audio.Sound.createAsync(
              require('@/assets/sounds/siren.mp3')
            );
            await sound1.setVolumeAsync(1.0);
            await sound1.playAsync();
            await new Promise(resolve => setTimeout(resolve, 800));
            await sound1.unloadAsync();
          } catch (err) {
            logError('Failed to play warning sound file, using system notification', err);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
          
          // Second INTENSE vibration burst
          for (let i = 0; i < 3; i++) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            Haptics.selectionAsync();
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          await new Promise(resolve => setTimeout(resolve, 400));
          
          // Second warning sound (with fallback)
          try {
            const { sound: sound2 } = await Audio.Sound.createAsync(
              require('@/assets/sounds/siren.mp3')
            );
            await sound2.setVolumeAsync(1.0);
            await sound2.playAsync();
            await new Promise(resolve => setTimeout(resolve, 800));
            await sound2.unloadAsync();
          } catch (err) {
            logError('Failed to play warning sound file 2, using system notification', err);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        } catch (err) {
          logError('Warning pattern error', err);
        }
      };
      
      triggerWarningPattern();
      
    } else if (!berth.is_warning && showingWarningAlert) {
      logInfo(`✅ Warning state cleared for ${berth.name}`);
      setShowingWarningAlert(false);
    }
  }, [berth?.is_warning]);

  /**
   * Setup gyroscope for compass rotation tracking when in critical state
   */
  useEffect(() => {
    if (!berth?.is_critical) return;

    // Set gyroscope update interval
    Gyroscope.setUpdateInterval(100);

    // Subscribe to gyroscope updates
    gyroscopeSubscriptionRef.current = Gyroscope.addListener(({ x, y, z }: any) => {
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
  }, [berth?.is_critical]);

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
        logInfo(`✅ Received update for ${data.name}`);
        setBerth(data);
        updateSortedBollards(data);
        dataReceived = true;
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
   * Navigate back to berth selection with cleanup (disabled during critical)
   */
  const handleBackPress = () => {
    if (berth?.is_critical) {
      // Simply return - back button is disabled during critical
      return;
    }
    teardownBerthListener();
    router.push({
      pathname: './berth-selection',
      params: { userName },
    });
  };

  /**
   * Show critical alert - handled via state and Modal component
   */
  const showCriticalAlert = (data: BerthData) => {
    // Alert is now controlled by showingCriticalAlert state and Modal
    const direction = data.danger_direction || 'UNKNOWN';
    logInfo(`🚨 Showing critical alert for direction: ${direction}`);
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
      {/* Critical alert modal with integrated compass */}
      <Modal
        visible={showingCriticalAlert && berth?.is_critical}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}} // Prevent back button from closing
      >
        <View style={styles.criticalAlertBackground}>
          {/* Top warning banner */}
          <View style={styles.criticalModalHeader}>
            <Text style={styles.criticalModalTitle}>🚨 CRITICAL EVACUATION 🚨</Text>
            <Text style={styles.criticalModalSubtitle}>Mooring tension exceeded safety limits!</Text>
          </View>

          {/* Compass circle */}
          <View
            style={[
              styles.compassOuter,
              {
                transform: [{ rotate: `${deviceRotation}deg` }],
              },
            ]}
          >
            {/* Cardinal directions with enhanced styling */}
            <Text key="compass-n" style={[styles.compassDirection, styles.compassN, styles.compassNLabel]}>N</Text>
            <Text key="compass-e" style={[styles.compassDirection, styles.compassE]}>E</Text>
            <Text key="compass-s" style={[styles.compassDirection, styles.compassS]}>S</Text>
            <Text key="compass-w" style={[styles.compassDirection, styles.compassW]}>W</Text>

            {/* Center circle with arrow */}
            <View style={styles.compassCenter}>
              <Text
                style={[
                  styles.compassArrow,
                  {
                    transform: [
                      {
                        rotate:
                          berth.danger_direction === 'N'
                            ? '0deg'
                            : berth.danger_direction === 'NE'
                            ? '45deg'
                            : berth.danger_direction === 'E'
                            ? '90deg'
                            : berth.danger_direction === 'SE'
                            ? '135deg'
                            : berth.danger_direction === 'S'
                            ? '180deg'
                            : berth.danger_direction === 'SW'
                            ? '225deg'
                            : berth.danger_direction === 'W'
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

          {/* Bottom info bar */}
          <View style={styles.criticalModalFooter}>
            <Text style={styles.directionLabel}>EVACUATE DIRECTION</Text>
            <Text style={styles.directionText}>
              {berth.danger_direction || 'UNKNOWN'}
            </Text>
            <Text style={styles.directionSubText}>
              Rotate device to align compass
            </Text>
          </View>
        </View>
      </Modal>

      {/* Warning modal */}
      <Modal
        visible={showingWarningAlert && berth?.is_warning}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowingWarningAlert(false)}
      >
        <View style={styles.warningAlertBackground}>
          {/* Warning header */}
          <View style={styles.warningModalHeader}>
            <Text style={styles.warningModalTitle}>⚠️ TENSION WARNING ⚠️</Text>
            <Text style={styles.warningModalSubtitle}>Hook tension needs adjustment</Text>
          </View>

          {/* Warning content */}
          <View style={styles.warningContent}>
            {berth?.warning_hooks && berth.warning_hooks.length > 0 ? (
              berth.warning_hooks.map((hookInfo, index) => (
                <View key={hookInfo.bollard + '-' + hookInfo.hook} style={styles.warningHookInfo}>
                  <Text style={styles.warningLabel}>Bollard</Text>
                  <Text style={styles.warningValue}>{hookInfo.bollard}</Text>
                  
                  <Text style={styles.warningLabel}>Hook Type</Text>
                  <Text style={styles.warningValue}>{hookInfo.hook}</Text>
                  
                  <Text style={styles.warningLabel}>Attached Line</Text>
                  <Text style={styles.warningValue}>{hookInfo.attached_line || 'N/A'}</Text>
                  
                  <Text style={styles.warningLabel}>Current Tension</Text>
                  <Text style={styles.warningValue}>{hookInfo.tension.toFixed(2)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.warningText}>Adjusting mooring lines...</Text>
            )}
          </View>

          {/* Warning Compass removed - showing only hook info */}

          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setShowingWarningAlert(false)}
          >
            <Text style={styles.closeButtonText}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={[styles.backButton, berth?.is_critical && styles.backButtonDisabled]} 
          onPress={handleBackPress}
          disabled={berth?.is_critical}
        >
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

        {/* Debug Buttons */}
        <View style={styles.debugButtonContainer}>
          <TouchableOpacity 
            style={styles.debugButtonCritical}
            onPress={async () => {
              try {
                const response = await fetch('http://localhost:5000/api/berth/simulate-critical', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ berth_name: berthName })
                });
                const data = await response.json();
                logInfo('Critical simulation triggered:', data);
              } catch (err) {
                logError('Failed to trigger critical simulation', err);
              }
            }}
          >
            <Text style={styles.debugButtonText}>🔴 Critical</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.debugButtonWarning}
            onPress={async () => {
              try {
                const response = await fetch('http://localhost:5000/api/berth/simulate-warning', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ berth_name: berthName })
                });
                const data = await response.json();
                logInfo('Warning simulation triggered:', data);
              } catch (err) {
                logError('Failed to trigger warning simulation', err);
              }
            }}
          >
            <Text style={styles.debugButtonText}>🟠 Warning</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bollard list */}
      {sortedBollards.length > 0 ? (
        <FlatList
          data={sortedBollards}
          renderItem={renderBollard}
          keyExtractor={(item, index) => `${item.name}-${index}`}
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
  backButtonDisabled: {
    backgroundColor: '#94a3b8',
    opacity: 0.6,
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
  compassOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  compassTopBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderBottomWidth: 2,
    borderBottomColor: '#dc2626',
  },
  compassWarningText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#dc2626',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
    letterSpacing: 1,
  },
  compassSubText: {
    fontSize: 14,
    color: '#cbd5e1',
    marginTop: 6,
    fontStyle: 'italic',
  },
  compassOuter: {
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#1e293b',
    borderWidth: 4,
    borderColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: 20,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  compassDirection: {
    position: 'absolute',
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: '#dc2626',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  compassNLabel: {
    color: '#ef4444',
    fontSize: 42,
  },
  compassN: {
    top: 30,
  },
  compassE: {
    right: 30,
  },
  compassS: {
    bottom: 30,
  },
  compassW: {
    left: 30,
  },
  compassCenter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 15,
    elevation: 15,
  },
  compassArrow: {
    fontSize: 80,
    color: '#fff',
    fontWeight: 'bold',
  },
  compassBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderTopWidth: 2,
    borderTopColor: '#dc2626',
  },
  directionLabel: {
    fontSize: 12,
    color: '#cbd5e1',
    letterSpacing: 2,
    fontWeight: '600',
    marginBottom: 8,
  },
  directionText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#dc2626',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
    letterSpacing: 2,
  },
  directionSubText: {
    fontSize: 12,
    color: '#cbd5e1',
    marginTop: 8,
    fontStyle: 'italic',
  },
  // Critical alert modal styles - integrated with compass
  criticalAlertBackground: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  criticalModalHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderBottomWidth: 2,
    borderBottomColor: '#dc2626',
  },
  criticalModalTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#dc2626',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
    letterSpacing: 1,
  },
  criticalModalSubtitle: {
    fontSize: 14,
    color: '#cbd5e1',
    marginTop: 6,
    fontStyle: 'italic',
  },
  criticalModalFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderTopWidth: 2,
    borderTopColor: '#dc2626',
  },
  // Old modal styles - removed
  criticalAlertContainer: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 32,
    paddingVertical: 40,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 20,
    borderWidth: 3,
    borderColor: '#b91c1c',
  },
  criticalAlertTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  criticalAlertMessage: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  criticalAlertSubMessage: {
    fontSize: 16,
    color: '#fecaca',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  // Warning modal styles
  warningAlertBackground: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  warningModalHeader: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(251, 146, 60, 0.2)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fb923c',
  },
  warningModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fb923c',
    letterSpacing: 1,
  },
  warningModalSubtitle: {
    fontSize: 14,
    color: '#cbd5e1',
    marginTop: 6,
    fontStyle: 'italic',
  },
  warningContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },
  warningHookInfo: {
    width: '100%',
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    borderWidth: 2,
    borderColor: '#fb923c',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  warningLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  warningValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fb923c',
    marginBottom: 12,
  },
  warningText: {
    fontSize: 16,
    color: '#cbd5e1',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  closeButton: {
    width: '100%',
    paddingVertical: 14,
    marginBottom: 20,
    backgroundColor: '#fb923c',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 1,
  },
  debugButtonContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 0,
  },
  debugButtonCritical: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#dc2626',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugButtonWarning: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f97316',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
});
