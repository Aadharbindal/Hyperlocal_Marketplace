import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import { flushOutbox } from '@/api/client';

interface NetworkState {
  online: boolean;
  start(): () => void;
}

/** Connectivity store feeding the offline banner (EDGE_CASE_MATRIX NET-01). */
export const useNetwork = create<NetworkState>((set, get) => ({
  online: true,
  start() {
    const unsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      const wasOffline = !get().online;
      set({ online });
      // Coming back is the moment to send what was saved while the connection was gone. Only on
      // the transition, not on every NetInfo event - those fire often, and replaying a queue on
      // each one would hammer the server for nothing.
      if (online && wasOffline) {
        void flushOutbox().catch(() => {
          // Still not reachable. The queue is untouched and the next reconnection tries again.
        });
      }
    });
    return unsub;
  },
}));
