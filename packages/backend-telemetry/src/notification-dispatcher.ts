import { randomUUID } from "node:crypto";
import type { DispatchNotification, LiveEvent } from "./types.js";
import type { SlaAlert } from "./sla-monitor.js";

export class NotificationDispatcher {
  readonly queue: DispatchNotification[] = [];
  private readonly listeners = new Set<(event: LiveEvent) => void>();

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: LiveEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  enqueue(alert: SlaAlert): DispatchNotification | undefined {
    const existing = this.queue.find((item) => item.podId === alert.podId && item.kind === alert.kind);
    if (existing !== undefined) {
      return undefined;
    }
    const notification: DispatchNotification = {
      id: randomUUID(),
      kind: alert.kind,
      channel: "whatsapp+sms",
      podId: alert.podId,
      flightNumber: alert.flightNumber,
      message: alert.message,
      createdAt: new Date().toISOString(),
    };
    this.queue.push(notification);
    this.emit({ type: "alert", alert: notification });
    return notification;
  }

  clearPod(podId: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.podId === podId) {
        this.queue.splice(index, 1);
      }
    }
  }
}
