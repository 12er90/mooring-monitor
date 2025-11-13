import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { logInfo, logError } from '@/constants/config';
import { Magnetometer } from 'expo-sensors';

const SENSOR_UPDATE_INTERVAL = 100;

export default function EmergencyCompassScreen() {
  const { berthName, dangerDirection } = useLocalSearchParams<{
    berthName: string;
    dangerDirection: string;
  }>();
  const router = useRouter();
  const [heading, setHeading] = useState(0);
  const [rotationAnim] = useState(new Animated.Value(0));
  const [sensorEnabled, setSensorEnabled] = useState(false);

  // Set sensor update interval
  useEffect(() => {
    Magnetometer.setUpdateInterval(SENSOR_UPDATE_INTERVAL);
  }, []);

  // Subscribe to magnetometer
  useEffect(() => {
    setSensorEnabled(true);
    const subscription = Magnetometer.addListener(({ x, y }: { x: number; y: number }) => {
      // Calculate angle from magnetometer data
      let angle = Math.atan2(y, x) * (180 / Math.PI);
      angle = (angle + 90 + 360) % 360; // Normalize to 0-360

      setHeading(angle);

      // Animate compass rotation
      Animated.timing(rotationAnim, {
        toValue: angle,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      subscription.remove();
      setSensorEnabled(false);
    };
  }, [rotationAnim]);

  const getDangerArrowRotation = () => {
    // Parse danger direction or use numeric value
    let targetHeading = 0;
    if (dangerDirection === 'NORTH') {
      targetHeading = 0;
    } else if (dangerDirection === 'NORTHEAST') {
      targetHeading = 45;
    } else if (dangerDirection === 'EAST') {
      targetHeading = 90;
    } else if (dangerDirection === 'SOUTHEAST') {
      targetHeading = 135;
    } else if (dangerDirection === 'SOUTH') {
      targetHeading = 180;
    } else if (dangerDirection === 'SOUTHWEST') {
      targetHeading = 225;
    } else if (dangerDirection === 'WEST') {
      targetHeading = 270;
    } else if (dangerDirection === 'NORTHWEST') {
      targetHeading = 315;
    } else if (dangerDirection && !isNaN(Number(dangerDirection))) {
      targetHeading = Number(dangerDirection);
    }
    return targetHeading;
  };

  const getDangerArrowLabel = () => {
    if (dangerDirection && !isNaN(Number(dangerDirection))) {
      return `${Number(dangerDirection).toFixed(0)}°`;
    }
    return dangerDirection || 'UNKNOWN';
  };

  const dangerArrowRotation = getDangerArrowRotation();

  const handleReturn = () => {
    Alert.alert(
      'Return to Monitor',
      'Continue monitoring mooring tension?',
      [
        { text: 'Cancel', onPress: () => logInfo('Return cancelled') },
        {
          text: 'Yes',
          onPress: () => router.back(),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🚨 EMERGENCY</Text>
        <Text style={styles.headerSubtitle}>{berthName}</Text>
        <Text style={styles.headerAlert}>CRITICAL MOORING TENSION</Text>
      </View>

      {/* Main compass area */}
      <View style={styles.compassContainer}>
        {/* Compass circle background */}
        <View style={styles.compassBackground}>
          {/* Cardinal directions */}
          <View style={[styles.cardinalMarker, { top: 10 }]}>
            <Text style={styles.cardinalText}>N</Text>
          </View>
          <View style={[styles.cardinalMarker, { bottom: 10, alignItems: 'center' }]}>
            <Text style={styles.cardinalText}>S</Text>
          </View>
          <View style={[styles.cardinalMarker, { left: 10 }]}>
            <Text style={styles.cardinalText}>W</Text>
          </View>
          <View style={[styles.cardinalMarker, { right: 10 }]}>
            <Text style={styles.cardinalText}>E</Text>
          </View>

          {/* Heading indicator (compass rose) */}
          <Animated.View
            style={[
              styles.compassRose,
              {
                transform: [{ rotate: `${heading}deg` }],
              },
            ]}
          >
            <View style={styles.northIndicator} />
            <View style={styles.southIndicator} />
          </Animated.View>

          {/* Danger direction arrow */}
          <View
            style={[
              styles.dangerArrow,
              {
                transform: [
                  { rotate: `${dangerArrowRotation}deg` },
                ],
              },
            ]}
          >
            <View style={styles.arrowHead}>
              <Text style={styles.arrowText}>→</Text>
            </View>
          </View>

          {/* Center indicator */}
          <View style={styles.centerDot} />
        </View>

        {/* Heading display */}
        <View style={styles.headingDisplay}>
          <Text style={styles.headingValue}>{heading.toFixed(0)}°</Text>
          <Text style={styles.headingLabel}>Current Heading</Text>
        </View>
      </View>

      {/* Danger direction info */}
      <View style={styles.dangerInfo}>
        <Text style={styles.dangerInfoTitle}>🏃 RUN DIRECTION</Text>
        <View style={styles.dangerInfoBox}>
          <Text style={styles.dangerDirectionText}>{getDangerArrowLabel()}</Text>
          <Text style={styles.dangerInstructions}>
            All crew members should evacuate in this direction
          </Text>
        </View>
      </View>

      {/* Status info */}
      <View style={styles.statusBox}>
        <Text style={styles.statusLabel}>Critical Tension Detected</Text>
        <Text style={styles.statusValue}>
          ⚠️ One or more mooring lines exceed 86 kN
        </Text>
      </View>

      {/* Return button */}
      <TouchableOpacity
        style={styles.returnButton}
        onPress={handleReturn}
        activeOpacity={0.8}
      >
        <Text style={styles.returnButtonText}>← Back to Monitor</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#dc2626',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 8,
  },
  headerAlert: {
    fontSize: 14,
    color: '#ef4444',
    fontWeight: '600',
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  compassContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },
  compassBackground: {
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  cardinalMarker: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardinalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3b82f6',
  },
  compassRose: {
    width: 200,
    height: 200,
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  northIndicator: {
    width: 6,
    height: 80,
    backgroundColor: '#3b82f6',
    borderRadius: 3,
    position: 'absolute',
    top: 10,
  },
  southIndicator: {
    width: 6,
    height: 80,
    backgroundColor: '#64748b',
    borderRadius: 3,
    position: 'absolute',
    bottom: 10,
  },
  dangerArrow: {
    position: 'absolute',
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowHead: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowText: {
    fontSize: 48,
    color: '#dc2626',
    fontWeight: 'bold',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  centerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#dc2626',
    position: 'absolute',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 5,
  },
  headingDisplay: {
    alignItems: 'center',
    marginTop: 16,
  },
  headingValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 4,
  },
  headingLabel: {
    fontSize: 13,
    color: '#94a3b8',
  },
  dangerInfo: {
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  dangerInfoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fca5a5',
    marginBottom: 8,
  },
  dangerInfoBox: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
  },
  dangerDirectionText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#dc2626',
    marginBottom: 6,
  },
  dangerInstructions: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 18,
  },
  statusBox: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },
  statusLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 14,
    color: '#fca5a5',
    fontWeight: '600',
  },
  returnButton: {
    backgroundColor: '#334155',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#475569',
  },
  returnButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
});
