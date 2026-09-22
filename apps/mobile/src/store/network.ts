import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

interface NetworkState {
  online: boolean;
  start(): () => void;
}

/** Connectivity store feeding the offline banner (EDGE_CASE_MATRIX NET-01). */
export const useNetwork = create<NetworkState>((set) => ({
  online: true,
  start() {
    const unsub = NetInfo.addEventListener((state) => {
      set({ online: state.isConnected !== false && state.isInternetReachable !== false });
    });
    return unsub;
  },
}));
