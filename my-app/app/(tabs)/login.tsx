import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { logInfo, logError } from '@/constants/config';
import WebSocketService from '@/services/WebSocketService';
import ApiService from '@/services/ApiService';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    if (!userName.trim()) {
      Alert.alert('⚠️ Required', 'Please enter your name');
      return;
    }

    setLoading(true);
    try {
      logInfo('Login initiated', { user: userName });

      // Check server health
      await ApiService.healthCheck();
      logInfo('✅ Server is healthy');

      // Generate port data
      await ApiService.generatePort();
      logInfo('✅ Port data generated');

      // Connect WebSocket
      await WebSocketService.connect();
      logInfo('✅ WebSocket connected');

      // Navigate to berth selection
      router.replace({
        pathname: './berth-selection',
        params: { userName: userName.trim() },
      });
    } catch (error) {
      logError('Login failed', error instanceof Error ? error.message : String(error));
      Alert.alert(
        '❌ Connection Error',
        `Failed to connect to backend:\n${error instanceof Error ? error.message : 'Unknown error'}\n\nMake sure:\n1. Backend is running\n2. IP is correct in config.ts\n3. Phone and computer on same WiFi`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.emoji}>🚢</Text>
          <Text style={styles.title}>Mooring Monitor</Text>
          <Text style={styles.subtitle}>Ship Crew Safety System</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>👤 Enter Your Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., John Doe"
            placeholderTextColor="#64748b"
            value={userName}
            onChangeText={setUserName}
            autoCapitalize="words"
            editable={!loading}
            maxLength={50}
          />

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.disabledButton]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Text style={styles.loginButtonText}>Enter App</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Monitor mooring line tension in real-time
          </Text>
          <Text style={styles.footerSubtext}>
            Get emergency evacuation guidance when critical
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 80,
  },
  emoji: {
    fontSize: 60,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
  },
  formContainer: {
    marginBottom: 80,
  },
  label: {
    fontSize: 14,
    color: '#cbd5e1',
    marginBottom: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loginButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  disabledButton: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  footerText: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748b',
  },
});
