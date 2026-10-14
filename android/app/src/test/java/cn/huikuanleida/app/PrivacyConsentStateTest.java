package cn.huikuanleida.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PrivacyConsentStateTest {
    @Test
    public void currentConsentVersionIsAccepted() {
        assertTrue(PrivacyConsentState.isAccepted("1.0"));
    }

    @Test
    public void missingOrOldConsentVersionIsRejected() {
        assertFalse(PrivacyConsentState.isAccepted(null));
        assertFalse(PrivacyConsentState.isAccepted(""));
        assertFalse(PrivacyConsentState.isAccepted("0.9"));
    }
}
