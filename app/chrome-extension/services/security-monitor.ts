/**
 * Security monitoring service for detecting anomalous behavior and potential threats
 * Provides real-time monitoring, anomaly detection, and security alerting
 */

import { SecureStorage } from './secure-storage';

export interface SecurityEvent {
  id: string;
  type: 'authentication' | 'permission' | 'network' | 'data_access' | 'tool_usage' | 'system';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  source: string;
  details: any;
  userAgent?: string;
  ipAddress?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsByType: { [key: string]: number };
  eventsBySeverity: { [key: string]: number };
  lastEventTime: number;
  suspiciousActivityScore: number;
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ThreatPattern {
  id: string;
  name: string;
  description: string;
  indicators: Array<{
    type: string;
    field: string;
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'regex';
    value: any;
    weight: number;
  }>;
  threshold: number;
  action: 'log' | 'alert' | 'block';
}

export class SecurityMonitor {
  private static readonly ENABLED_KEY = 'security_monitor_enabled';
  private static readonly EVENTS_STORAGE_KEY = 'security_events';
  private static readonly METRICS_STORAGE_KEY = 'security_metrics';
  private static readonly MAX_STORED_EVENTS = 1000;
  private static readonly ANOMALY_THRESHOLD = 3; // Standard deviations
  private static readonly HIGH_FREQUENCY_THRESHOLD = 10; // Events per minute
  private static readonly RATE_LIMIT_WINDOW = 1000; // 1 second
  private static readonly RATE_LIMIT_MAX_EVENTS = 5; // Max events per second
  private static rateLimitTimestamps: number[] = [];
  private static enabled: boolean = true;
  private static storageListenerRegistered = false;

  private static threatPatterns: ThreatPattern[] = [
    {
      id: 'rapid_tool_usage',
      name: 'Rapid Tool Usage',
      description: 'Unusually high frequency of tool usage',
      indicators: [
        {
          type: 'tool_usage',
          field: 'count_per_minute',
          operator: 'greater_than',
          value: 20,
          weight: 1.0,
        },
      ],
      threshold: 1.0,
      action: 'alert',
    },
    {
      id: 'failed_authentication',
      name: 'Failed Authentication Attempts',
      description: 'Multiple failed authentication attempts from external sources',
      indicators: [
        { type: 'authentication', field: 'success', operator: 'equals', value: false, weight: 0.3 },
        {
          type: 'authentication',
          field: 'source',
          operator: 'equals',
          value: 'external_auth',
          weight: 0.8,
        },
        {
          type: 'authentication',
          field: 'count_per_hour',
          operator: 'greater_than',
          value: 10,
          weight: 1.0,
        },
      ],
      threshold: 1.5,
      action: 'alert',
    },
    {
      id: 'suspicious_network_activity',
      name: 'Suspicious Network Activity',
      description: 'Network requests to unusual domains',
      indicators: [
        {
          type: 'network',
          field: 'domain',
          operator: 'regex',
          value: /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/,
          weight: 0.8,
        },
        { type: 'network', field: 'protocol', operator: 'equals', value: 'http', weight: 0.3 },
      ],
      threshold: 0.8,
      action: 'alert',
    },
    {
      id: 'permission_escalation',
      name: 'Permission Escalation Attempt',
      description: 'Attempt to escalate permissions without user consent',
      indicators: [
        { type: 'permission', field: 'escalation', operator: 'equals', value: true, weight: 1.0 },
        {
          type: 'permission',
          field: 'consent_bypassed',
          operator: 'equals',
          value: true,
          weight: 2.0,
        },
      ],
      threshold: 1.0,
      action: 'block',
    },
    {
      id: 'data_exfiltration',
      name: 'Potential Data Exfiltration',
      description: 'Large amounts of data being accessed or transmitted',
      indicators: [
        { type: 'data_access', field: 'size_mb', operator: 'greater_than', value: 10, weight: 0.7 },
        {
          type: 'network',
          field: 'upload_size_mb',
          operator: 'greater_than',
          value: 5,
          weight: 1.0,
        },
      ],
      threshold: 1.0,
      action: 'alert',
    },
  ];

  /**
   * Initialize security monitoring
   */
  static async initialize(): Promise<void> {
    try {
      // Load enabled flag
      await this.loadEnabledFromStorage();

      if (!this.enabled) {
        console.log('Security monitor is disabled via settings');
        return;
      }

      // Watch for runtime setting changes
      this.registerStorageListener();

      await this.cleanupOldEvents();
      await this.updateMetrics();
      this.startPeriodicTasks();
      console.log('Security monitor initialized');
    } catch (error) {
      console.error('Failed to initialize security monitor:', error);
      throw error;
    }
  }

  /**
   * Check if event should be rate limited
   */
  private static shouldRateLimit(): boolean {
    const now = Date.now();
    // Remove timestamps outside the window
    this.rateLimitTimestamps = this.rateLimitTimestamps.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW,
    );

    // Check if we're over the limit
    if (this.rateLimitTimestamps.length >= this.RATE_LIMIT_MAX_EVENTS) {
      return true;
    }

    // Add current timestamp
    this.rateLimitTimestamps.push(now);
    return false;
  }

  /**
   * Log a security event
   */
  static async logEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    try {
      // Respect global enabled flag
      if (!this.enabled) return;

      // Apply rate limiting for low-severity events
      if (event.severity === 'low' && this.shouldRateLimit()) {
        return; // Silently drop rate-limited low-severity events
      }

      const fullEvent: SecurityEvent = {
        ...event,
        id: this.generateEventId(),
        timestamp: Date.now(),
      };

      // Add browser context
      if (typeof navigator !== 'undefined') {
        fullEvent.userAgent = navigator.userAgent;
      }

      // Get existing events
      const events = await this.getStoredEvents();
      events.push(fullEvent);

      // Limit stored events
      if (events.length > this.MAX_STORED_EVENTS) {
        events.splice(0, events.length - this.MAX_STORED_EVENTS);
      }

      // Store events
      await SecureStorage.setItem(this.EVENTS_STORAGE_KEY, events, { encrypt: true });

      // Update metrics
      await this.updateMetrics();

      // Check for threats
      await this.checkThreatPatterns(fullEvent);

      // Check for anomalies
      await this.checkAnomalies(fullEvent);

      console.log(`Security event logged: ${event.type} - ${event.severity}`, fullEvent);
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  /**
   * Enable or disable the security monitor globally
   */
  static async setEnabled(enabled: boolean): Promise<void> {
    try {
      this.enabled = enabled;
      await chrome.storage.local.set({ [this.ENABLED_KEY]: enabled });
    } catch (error) {
      console.error('Failed to update security monitor setting:', error);
    }
  }

  static async getEnabled(): Promise<boolean> {
    try {
      const result = await chrome.storage.local.get([this.ENABLED_KEY]);
      return result[this.ENABLED_KEY] !== false; // default true
    } catch {
      return true;
    }
  }

  private static async loadEnabledFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([this.ENABLED_KEY]);
      this.enabled = result[this.ENABLED_KEY] !== false; // default true
    } catch {
      this.enabled = true;
    }
  }

  private static registerStorageListener(): void {
    if (this.storageListenerRegistered) return;
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[this.ENABLED_KEY]) {
        const nv = changes[this.ENABLED_KEY].newValue;
        this.enabled = nv !== false;
      }
    });
    this.storageListenerRegistered = true;
  }

  /**
   * Get stored security events
   */
  private static async getStoredEvents(): Promise<SecurityEvent[]> {
    try {
      return (await SecureStorage.getItem(this.EVENTS_STORAGE_KEY, { encrypt: true })) || [];
    } catch (error) {
      console.error('Failed to retrieve security events:', error);
      return [];
    }
  }

  /**
   * Get security metrics
   */
  static async getMetrics(): Promise<SecurityMetrics> {
    try {
      const defaultMetrics: SecurityMetrics = {
        totalEvents: 0,
        eventsByType: {},
        eventsBySeverity: {},
        lastEventTime: 0,
        suspiciousActivityScore: 0,
        threatLevel: 'low',
      };

      return (
        (await SecureStorage.getItem(this.METRICS_STORAGE_KEY, { encrypt: true })) || defaultMetrics
      );
    } catch (error) {
      console.error('Failed to retrieve security metrics:', error);
      return {
        totalEvents: 0,
        eventsByType: {},
        eventsBySeverity: {},
        lastEventTime: 0,
        suspiciousActivityScore: 0,
        threatLevel: 'low',
      };
    }
  }

  /**
   * Update security metrics
   */
  private static async updateMetrics(): Promise<void> {
    try {
      const events = await this.getStoredEvents();
      const now = Date.now();
      const recentEvents = events.filter((event) => now - event.timestamp < 24 * 60 * 60 * 1000); // Last 24 hours

      const metrics: SecurityMetrics = {
        totalEvents: events.length,
        eventsByType: {},
        eventsBySeverity: {},
        lastEventTime: events.length > 0 ? Math.max(...events.map((e) => e.timestamp)) : 0,
        suspiciousActivityScore: this.calculateSuspiciousActivityScore(recentEvents),
        threatLevel: 'low',
      };

      // Count events by type
      events.forEach((event) => {
        metrics.eventsByType[event.type] = (metrics.eventsByType[event.type] || 0) + 1;
        metrics.eventsBySeverity[event.severity] =
          (metrics.eventsBySeverity[event.severity] || 0) + 1;
      });

      // Determine threat level
      if (metrics.suspiciousActivityScore > 80) {
        metrics.threatLevel = 'critical';
      } else if (metrics.suspiciousActivityScore > 60) {
        metrics.threatLevel = 'high';
      } else if (metrics.suspiciousActivityScore > 30) {
        metrics.threatLevel = 'medium';
      }

      await SecureStorage.setItem(this.METRICS_STORAGE_KEY, metrics, { encrypt: true });
    } catch (error) {
      console.error('Failed to update security metrics:', error);
    }
  }

  /**
   * Calculate suspicious activity score
   */
  private static calculateSuspiciousActivityScore(events: SecurityEvent[]): number {
    let score = 0;
    const now = Date.now();

    events.forEach((event) => {
      // Base score by severity
      const severityScores = { low: 1, medium: 5, high: 15, critical: 25 };
      let eventScore = severityScores[event.severity] || 0;

      // Time decay (more recent events have higher impact)
      const ageHours = (now - event.timestamp) / (60 * 60 * 1000);
      const timeMultiplier = Math.max(0.1, 1 - ageHours / 24); // Decay over 24 hours

      eventScore *= timeMultiplier;

      // Type-specific multipliers
      const typeMultipliers = {
        authentication: 1.5,
        permission: 2.0,
        network: 1.2,
        data_access: 1.8,
        tool_usage: 1.0,
        system: 1.3,
      };

      eventScore *= typeMultipliers[event.type] || 1.0;

      score += eventScore;
    });

    return Math.min(100, Math.round(score));
  }

  /**
   * Check for threat patterns
   */
  private static async checkThreatPatterns(event: SecurityEvent): Promise<void> {
    const events = await this.getStoredEvents();
    const recentEvents = events.filter((e) => Date.now() - e.timestamp < 60 * 60 * 1000); // Last hour

    for (const pattern of this.threatPatterns) {
      const score = this.evaluateThreatPattern(pattern, event, recentEvents);

      if (score >= pattern.threshold) {
        await this.handleThreatDetection(pattern, event, score);
      }
    }
  }

  /**
   * Evaluate threat pattern against events
   */
  private static evaluateThreatPattern(
    pattern: ThreatPattern,
    currentEvent: SecurityEvent,
    recentEvents: SecurityEvent[],
  ): number {
    let score = 0;

    for (const indicator of pattern.indicators) {
      if (indicator.type === currentEvent.type) {
        if (this.matchesIndicator(indicator, currentEvent, recentEvents)) {
          score += indicator.weight;
        }
      }
    }

    return score;
  }

  /**
   * Check if event matches threat indicator
   */
  private static matchesIndicator(
    indicator: any,
    event: SecurityEvent,
    recentEvents: SecurityEvent[],
  ): boolean {
    const { field, operator, value } = indicator;

    // Handle special aggregated fields
    if (field === 'count_per_minute') {
      const lastMinute = Date.now() - 60 * 1000;
      const count = recentEvents.filter(
        (e) => e.timestamp > lastMinute && e.type === event.type,
      ).length;
      return this.compareValues(count, operator, value);
    }

    if (field === 'count_per_hour') {
      const lastHour = Date.now() - 60 * 60 * 1000;
      const count = recentEvents.filter(
        (e) => e.timestamp > lastHour && e.type === event.type,
      ).length;
      return this.compareValues(count, operator, value);
    }

    // Handle regular fields
    const fieldValue = this.getNestedValue(event, field);
    return this.compareValues(fieldValue, operator, value);
  }

  /**
   * Compare values using operator
   */
  private static compareValues(actual: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'contains':
        return typeof actual === 'string' && actual.includes(expected);
      case 'greater_than':
        return typeof actual === 'number' && actual > expected;
      case 'less_than':
        return typeof actual === 'number' && actual < expected;
      case 'regex':
        return typeof actual === 'string' && expected.test(actual);
      default:
        return false;
    }
  }

  /**
   * Get nested object value by path
   */
  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Handle threat detection
   */
  private static async handleThreatDetection(
    pattern: ThreatPattern,
    event: SecurityEvent,
    score: number,
  ): Promise<void> {
    const threatEvent: SecurityEvent = {
      id: this.generateEventId(),
      type: 'system',
      severity: 'high',
      timestamp: Date.now(),
      source: 'security_monitor',
      details: {
        threatPattern: pattern.name,
        description: pattern.description,
        matchScore: score,
        threshold: pattern.threshold,
        triggeringEvent: event.id,
        action: pattern.action,
      },
    };

    // Log the threat detection
    const events = await this.getStoredEvents();
    events.push(threatEvent);
    await SecureStorage.setItem(this.EVENTS_STORAGE_KEY, events, { encrypt: true });

    console.warn(`Threat detected: ${pattern.name}`, {
      pattern: pattern.id,
      score,
      event: event.id,
      action: pattern.action,
    });

    // Execute action
    switch (pattern.action) {
      case 'block':
        await this.executeBlockAction(pattern, event);
        break;
      case 'alert':
        await this.executeAlertAction(pattern, event);
        break;
      case 'log':
        // Already logged above
        break;
    }
  }

  /**
   * Execute block action
   */
  private static async executeBlockAction(
    pattern: ThreatPattern,
    event: SecurityEvent,
  ): Promise<void> {
    console.error(`SECURITY BLOCK: ${pattern.name} - ${pattern.description}`);

    // Create blocking event
    await this.logEvent({
      type: 'system',
      severity: 'critical',
      source: 'security_monitor',
      details: {
        action: 'blocked',
        reason: pattern.name,
        blockedEvent: event.id,
      },
    });

    // In a real implementation, you might:
    // - Disable certain features
    // - Require re-authentication
    // - Show security warning to user
    // - Temporarily lock the extension
  }

  /**
   * Execute alert action
   */
  private static async executeAlertAction(
    pattern: ThreatPattern,
    event: SecurityEvent,
  ): Promise<void> {
    console.warn(`SECURITY ALERT: ${pattern.name} - ${pattern.description}`);

    // Create alert event
    await this.logEvent({
      type: 'system',
      severity: 'medium',
      source: 'security_monitor',
      details: {
        action: 'alerted',
        reason: pattern.name,
        alertedEvent: event.id,
      },
    });

    // In a real implementation, you might:
    // - Show user notification
    // - Send alert to admin dashboard
    // - Increase monitoring sensitivity
    // - Request user verification
  }

  /**
   * Check for statistical anomalies
   */
  private static async checkAnomalies(event: SecurityEvent): Promise<void> {
    const events = await this.getStoredEvents();
    const recentEvents = events.filter((e) => Date.now() - e.timestamp < 24 * 60 * 60 * 1000);

    // Check frequency anomalies
    const eventsByMinute = this.groupEventsByTimeWindow(recentEvents, 60 * 1000);
    const frequencies = Object.values(eventsByMinute);

    if (frequencies.length > 5) {
      // Need sufficient data
      const { mean, stdDev } = this.calculateStats(frequencies);
      const currentMinute = Math.floor(Date.now() / (60 * 1000));
      const currentFrequency = eventsByMinute[currentMinute] || 0;

      if (currentFrequency > mean + this.ANOMALY_THRESHOLD * stdDev) {
        await this.logEvent({
          type: 'system',
          severity: 'medium',
          source: 'anomaly_detector',
          details: {
            anomalyType: 'frequency',
            currentValue: currentFrequency,
            expectedMean: mean,
            standardDeviations: (currentFrequency - mean) / stdDev,
            threshold: this.ANOMALY_THRESHOLD,
          },
        });
      }
    }

    // Check for unusual event types
    const typeFrequencies = recentEvents.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      },
      {} as { [key: string]: number },
    );

    for (const [type, count] of Object.entries(typeFrequencies)) {
      if (count > this.HIGH_FREQUENCY_THRESHOLD) {
        await this.logEvent({
          type: 'system',
          severity: 'medium',
          source: 'anomaly_detector',
          details: {
            anomalyType: 'high_frequency_event_type',
            eventType: type,
            count,
            threshold: this.HIGH_FREQUENCY_THRESHOLD,
            timeWindow: '24h',
          },
        });
      }
    }
  }

  /**
   * Group events by time windows
   */
  private static groupEventsByTimeWindow(
    events: SecurityEvent[],
    windowMs: number,
  ): { [key: number]: number } {
    const grouped: { [key: number]: number } = {};

    events.forEach((event) => {
      const windowKey = Math.floor(event.timestamp / windowMs);
      grouped[windowKey] = (grouped[windowKey] || 0) + 1;
    });

    return grouped;
  }

  /**
   * Calculate statistical measures
   */
  private static calculateStats(values: number[]): { mean: number; stdDev: number } {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev };
  }

  /**
   * Clean up old events
   */
  private static async cleanupOldEvents(): Promise<void> {
    try {
      const events = await this.getStoredEvents();
      const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
      const recentEvents = events.filter((event) => event.timestamp > cutoffTime);

      if (recentEvents.length !== events.length) {
        await SecureStorage.setItem(this.EVENTS_STORAGE_KEY, recentEvents, { encrypt: true });
        console.log(`Cleaned up ${events.length - recentEvents.length} old security events`);
      }
    } catch (error) {
      console.error('Failed to cleanup old events:', error);
    }
  }

  /**
   * Generate unique event ID
   */
  private static generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start periodic monitoring tasks
   */
  private static startPeriodicTasks(): void {
    // Update metrics every 5 minutes
    setInterval(
      () => {
        this.updateMetrics().catch(console.error);
      },
      5 * 60 * 1000,
    );

    // Cleanup old events every hour
    setInterval(
      () => {
        this.cleanupOldEvents().catch(console.error);
      },
      60 * 60 * 1000,
    );
  }

  /**
   * Get events by criteria
   */
  static async getEvents(
    criteria: {
      type?: string;
      severity?: string;
      source?: string;
      since?: number;
      limit?: number;
    } = {},
  ): Promise<SecurityEvent[]> {
    try {
      let events = await this.getStoredEvents();

      // Apply filters
      if (criteria.type) {
        events = events.filter((e) => e.type === criteria.type);
      }

      if (criteria.severity) {
        events = events.filter((e) => e.severity === criteria.severity);
      }

      if (criteria.source) {
        events = events.filter((e) => e.source === criteria.source);
      }

      if (typeof criteria.since === 'number') {
        events = events.filter((e) => e.timestamp >= criteria.since!);
      }

      // Sort by timestamp (newest first)
      events.sort((a, b) => b.timestamp - a.timestamp);

      // Apply limit
      if (criteria.limit && criteria.limit > 0) {
        events = events.slice(0, criteria.limit);
      }

      return events;
    } catch (error) {
      console.error('Failed to get security events:', error);
      return [];
    }
  }

  /**
   * Clear all security events
   */
  static async clearEvents(): Promise<void> {
    try {
      await SecureStorage.removeItem(this.EVENTS_STORAGE_KEY);
      await SecureStorage.removeItem(this.METRICS_STORAGE_KEY);
      console.log('All security events cleared');
    } catch (error) {
      console.error('Failed to clear security events:', error);
      throw error;
    }
  }

  /**
   * Export security report
   */
  static async exportSecurityReport(): Promise<{
    metrics: SecurityMetrics;
    recentEvents: SecurityEvent[];
    threatPatterns: ThreatPattern[];
    exportTime: number;
  }> {
    try {
      const metrics = await this.getMetrics();
      const recentEvents = await this.getEvents({
        since: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
        limit: 100,
      });

      return {
        metrics,
        recentEvents,
        threatPatterns: this.threatPatterns,
        exportTime: Date.now(),
      };
    } catch (error) {
      console.error('Failed to export security report:', error);
      throw error;
    }
  }
}
