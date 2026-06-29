/**
 * Inbound Message Classifier
 * Distinguishes between:
 * - Thumbtack leads (paid acquisition channel)
 * - Regular customer SMS (organic)
 * - Bounced auto-replies (ignore)
 */

/**
 * Detect if SMS is from Thumbtack
 * Thumbtack messages from platform:
 * - Include phrases like "New lead", "customer is looking for", "lead details"
 * - May come from rotating numbers
 * - Usually contain service type + location
 * - High intent (paid path)
 */
export function isThumbtack(text: string): boolean {
  const t = text.toLowerCase();

  const thumbtackIndicators = [
    'thumbtack',
    'new lead',
    'customer is looking for',
    'lead details',
    'customers looking',
    'found a local customer',
    'is interested in your',
    'thumbtack pro',
  ];

  return thumbtackIndicators.some((indicator) => t.includes(indicator));
}

/**
 * Detect if SMS is a bounced auto-reply or undeliverable notice
 * Skip these to avoid noise
 */
export function isAutoReply(text: string): boolean {
  const t = text.toLowerCase();

  const autoReplyIndicators = [
    'out of office',
    'auto responder',
    'temporarily unavailable',
    'voicemail',
    'undeliverable',
    'did not reach',
    'not a valid',
    'invalid number',
    'this is an automated',
  ];

  return autoReplyIndicators.some((indicator) => t.includes(indicator));
}

/**
 * Classify message type
 */
export type MessageClassification = 'thumbtack' | 'customer' | 'autoReply' | 'unknown';

export function classify(text: string): MessageClassification {
  if (isAutoReply(text)) return 'autoReply';
  if (isThumbtack(text)) return 'thumbtack';

  // Default to customer if has some text
  if (text.trim().length > 0) return 'customer';

  return 'unknown';
}

/**
 * Get confidence score for classification
 * (Future: use for ML model uncertainty)
 */
export function classificationConfidence(text: string): number {
  if (isAutoReply(text)) return 0.95; // High confidence
  if (isThumbtack(text)) return 0.85; // Good confidence
  return 0.6; // Lower confidence for general customer
}
