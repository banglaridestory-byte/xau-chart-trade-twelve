import { CONFIG } from './config.js';

export class CreditBudget {
  constructor({
    perMinute = CONFIG.maxCreditsPerMinute,
    perDay = CONFIG.maxCreditsPerDay,
  } = {}) {
    this.perMinute = perMinute;
    this.perDay = perDay;
    this.minuteWindow = -1;
    this.minuteUsed = 0;
    this.dayKey = '';
    this.dayUsed = 0;
    this.totalUsed = 0;
    this.rejected = 0;
  }

  #rotate(now) {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minuteWindow) {
      this.minuteWindow = minute;
      this.minuteUsed = 0;
    }
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.dayKey) {
      this.dayKey = day;
      this.dayUsed = 0;
    }
  }

  snapshot(now = Date.now()) {
    this.#rotate(now);
    return {
      perMinute: this.perMinute,
      perDay: this.perDay,
      minuteUsed: this.minuteUsed,
      dayUsed: this.dayUsed,
      totalUsed: this.totalUsed,
      rejected: this.rejected,
    };
  }

  canSpend(cost = 1) {
    const state = this.snapshot();
    return (
      state.minuteUsed + cost <= this.perMinute &&
      state.dayUsed + cost <= this.perDay
    );
  }

  spend(cost = 1) {
    if (!this.canSpend(cost)) {
      this.rejected += 1;
      return false;
    }
    this.#rotate(Date.now());
    this.minuteUsed += cost;
    this.dayUsed += cost;
    this.totalUsed += cost;
    return true;
  }

  refund(cost = 1) {
    this.minuteUsed = Math.max(0, this.minuteUsed - cost);
    this.dayUsed = Math.max(0, this.dayUsed - cost);
    this.totalUsed = Math.max(0, this.totalUsed - cost);
  }
}

export const creditBudget = new CreditBudget();
