// src/backend/hotspot-mac.ts
import { execFile } from "child_process";
import sudo from "sudo-prompt";

export const HOTSPOT_IP = "192.168.2.1";

// ─── One‑time setup script ─────────────────────────────
// This creates a dummy network service and configures
// Internet Sharing to share it as a Wi‑Fi hotspot.
const SETUP_SCRIPT = `
  # Create a virtual network service (if not exists)
  networksetup -listnetworkserviceorder | grep -q "MAYO Dummy"
  if [ $? -ne 0 ]; then
    networksetup -createnetworkservice "MAYO Dummy" dummy
    networksetup -setmanual "MAYO Dummy" ${HOTSPOT_IP} 255.255.255.0
  fi

  # Enable the dummy service
  networksetup -setnetworkserviceenabled "MAYO Dummy" on

  # Configure Internet Sharing plist
  sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.nat NAT -dict-add SharingNetworkNumberStart 192.168.2.0
  sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.nat NAT -dict-add SharingNetworkNumberEnd 192.168.2.255
  sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.nat NAT -dict-add SharingNetworkNumberMask 255.255.255.0

  # Load the Internet Sharing service
  sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.InternetSharing.plist
`;

// ─── Public API ────────────────────────────────────────

/**
 * Run the one‑time setup (requires sudo).
 * Returns a promise that resolves when done.
 */
export function configureHotspot(): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      name: "MAYO Share",
      icns: undefined, // optionally provide an icon
    };
    sudo.exec(SETUP_SCRIPT, options, (error: any, stdout: any, stderr: any) => {
      if (error) {
        reject(stderr || error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Start the hotspot (must already be configured).
 * This simply loads the launchd service.
 */
export function startHotspot(): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = `sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.InternetSharing.plist`;
    execFile("bash", ["-c", cmd], { timeout: 10000 }, (error) => {
      if (error) {
        reject(error.message);
      } else {
        resolve(HOTSPOT_IP);
      }
    });
  });
}

/**
 * Stop the hotspot.
 */
export function stopHotspot(): Promise<void> {
  return new Promise((resolve) => {
    const cmd = `sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.InternetSharing.plist`;
    execFile("bash", ["-c", cmd], { timeout: 10000 }, () => {
      resolve(); // ignore errors on stop
    });
  });
}
