import type { YouTubeStatus } from '@opensekai/contracts';

// The status line of the YouTube setting (B25 R16).
export const youtubeStatusText = (status: YouTubeStatus | undefined): string => {
 switch (status?.state) {
  case 'waiting': return 'Waiting for stream';
  case 'live': return 'Live';
  case 'ended': return 'Chat ended';
  case 'error': return `Error: ${status.error ?? 'Unknown'}`;
  default: return 'Not connected';
 }
};
