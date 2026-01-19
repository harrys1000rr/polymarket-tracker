export function formatCurrency(value: number | null | undefined, currency: 'GBP' | 'USD' = 'GBP'): string {
  const symbol = currency === 'GBP' ? '£' : '$';
  const safeValue = value ?? 0;
  const absValue = Math.abs(safeValue);

  if (absValue >= 1000000) {
    return `${safeValue < 0 ? '-' : ''}${symbol}${(absValue / 1000000).toFixed(2)}M`;
  }
  if (absValue >= 1000) {
    return `${safeValue < 0 ? '-' : ''}${symbol}${(absValue / 1000).toFixed(2)}K`;
  }

  return `${safeValue < 0 ? '-' : ''}${symbol}${absValue.toFixed(2)}`;
}

export function formatPnl(value: number | null | undefined, currency: 'GBP' | 'USD' = 'GBP'): string {
  const safeValue = value ?? 0;
  const formatted = formatCurrency(Math.abs(safeValue), currency);
  if (safeValue > 0) return `+${formatted}`;
  if (safeValue < 0) return `-${formatted.replace('-', '')}`;
  return formatted;
}

export function formatPercent(value: number | null | undefined, decimals: number = 1): string {
  const safeValue = value ?? 0;
  const sign = safeValue > 0 ? '+' : '';
  return `${sign}${safeValue.toFixed(decimals)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  const safeValue = value ?? 0;
  if (safeValue >= 1000000) {
    return `${(safeValue / 1000000).toFixed(2)}M`;
  }
  if (safeValue >= 1000) {
    return `${(safeValue / 1000).toFixed(1)}K`;
  }
  return safeValue.toFixed(0);
}

export function formatWalletAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimeAgo(timestamp: string | number | Date): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function formatDate(timestamp: string | number | Date): string {
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(timestamp: string | number | Date): string {
  return new Date(timestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getPnlColor(value: number | null | undefined): string {
  const safeValue = value ?? 0;
  if (safeValue > 0) return 'text-green-600 dark:text-green-400';
  if (safeValue < 0) return 'text-red-600 dark:text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}

export function getPnlBgColor(value: number | null | undefined): string {
  const safeValue = value ?? 0;
  if (safeValue > 0) return 'bg-green-50 dark:bg-green-900/20';
  if (safeValue < 0) return 'bg-red-50 dark:bg-red-900/20';
  return 'bg-gray-50 dark:bg-gray-800';
}
