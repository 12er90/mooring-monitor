import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { logInfo, logError } from '@/constants/config';
import ApiService from '@/services/ApiService';

interface Berth {
  name: string;
  has_ship: boolean;
  ship_name?: string;
}

export default function BerthSelectionScreen() {
  const { userName } = useLocalSearchParams<{ userName: string }>();
  const router = useRouter();
  const [berths, setBerths] = useState<Berth[]>([]);
  const [portName, setPortName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchBerths();
  }, []);

  const fetchBerths = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getBerthsList();
      setBerths(data.berths || []);
      setPortName(data.port_name || 'Port');
      logInfo('Berths loaded', { count: data.berths.length });
    } catch (error) {
      logError('Failed to load berths', error instanceof Error ? error.message : String(error));
      Alert.alert('❌ Error', 'Failed to load berths. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchBerths();
  };

  const handleSelectBerth = (berth: Berth) => {
    logInfo('Berth selected', { name: berth.name });
    router.push({
      pathname: './berth-monitor',
      params: {
        userName,
        berthName: berth.name,
        portName,
      },
    });
  };

  const renderBerthCard = ({ item }: { item: Berth }) => (
    <TouchableOpacity
      style={styles.berthCard}
      onPress={() => handleSelectBerth(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.berthName}>{item.name}</Text>
          {item.has_ship && (
            <Text style={styles.shipName}>🚢 {item.ship_name}</Text>
          )}
        </View>
        <View
          style={[
            styles.statusBadge,
            item.has_ship ? styles.statusActive : styles.statusEmpty,
          ]}
        >
          <Text style={styles.statusText}>
            {item.has_ship ? '🔴 ACTIVE' : '⚪ EMPTY'}
          </Text>
        </View>
      </View>
      <Text style={styles.tapText}>→ Tap to monitor</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading berths...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>⚓</Text>
        <Text style={styles.headerTitle}>{portName}</Text>
        <Text style={styles.headerSubtitle}>Welcome, {userName}</Text>
      </View>

      {berths.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyText}>No berths available</Text>
        </View>
      ) : (
        <FlatList
          data={berths}
          renderItem={renderBerthCard}
          keyExtractor={item => item.name}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#3b82f6"
            />
          }
        />
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
  header: {
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center',
  },
  headerEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  berthCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  berthName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  shipName: {
    fontSize: 14,
    color: '#94a3b8',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: '#22c55e',
  },
  statusEmpty: {
    backgroundColor: '#64748b',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tapText: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyEmoji: {
    fontSize: 60,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    color: '#64748b',
  },
});
