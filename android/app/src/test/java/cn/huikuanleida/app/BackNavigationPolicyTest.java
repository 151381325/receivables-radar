package cn.huikuanleida.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BackNavigationPolicyTest {
    @Test public void consumedBackDoesNotExit() {
        assertEquals(BackNavigationPolicy.Decision.HANDLED, BackNavigationPolicy.interpret("true"));
    }
    @Test public void onlyExplicitBooleanFalseAllowsNativeFallback() {
        assertEquals(BackNavigationPolicy.Decision.FALLBACK, BackNavigationPolicy.interpret("false"));
        for (String value : new String[] {null, "null", "\"false\"", "undefined", "", "{}"}) {
            assertEquals(BackNavigationPolicy.Decision.STAY, BackNavigationPolicy.interpret(value));
        }
    }
}
