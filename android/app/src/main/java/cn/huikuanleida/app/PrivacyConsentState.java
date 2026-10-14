package cn.huikuanleida.app;

final class PrivacyConsentState {
    static final String CURRENT_VERSION = "1.0";

    private PrivacyConsentState() {}

    static boolean isAccepted(String acceptedVersion) {
        return CURRENT_VERSION.equals(acceptedVersion);
    }
}
