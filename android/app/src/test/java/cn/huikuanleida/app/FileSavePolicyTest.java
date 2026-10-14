package cn.huikuanleida.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class FileSavePolicyTest {
    @Test public void onlyTrustedOriginMayExport() {
        assertTrue(FileSavePolicy.allowsOrigin("https://huikuanleida.cn/my", false));
        assertFalse(FileSavePolicy.allowsOrigin("http://huikuanleida.cn", false));
        assertFalse(FileSavePolicy.allowsOrigin("https://huikuanleida.cn.evil.test", false));
        assertFalse(FileSavePolicy.allowsOrigin("https://evil@huikuanleida.cn", false));
        assertFalse(FileSavePolicy.allowsOrigin("http://127.0.0.1:18765", false));
        assertTrue(FileSavePolicy.allowsOrigin("http://127.0.0.1:18765", true));
    }
    @Test public void validatesTypeSizeAndFilename() {
        assertEquals("备份.json", FileSavePolicy.validate("备份.json", "{}", "application/json"));
        assertEquals("提醒.ics", FileSavePolicy.validate("提醒.ics", "BEGIN:VCALENDAR", "text/calendar"));
        for (String name : new String[] { "../backup.json", "a/b.json", "a\\b.json", "x.exe", "", "x\n.json" }) {
            assertThrows(IllegalArgumentException.class, () -> FileSavePolicy.validate(name, "{}", "application/json"));
        }
        assertThrows(IllegalArgumentException.class, () -> FileSavePolicy.validate("x.json", "{}", "text/html"));
        assertThrows(IllegalArgumentException.class, () -> FileSavePolicy.validate("x.json", "x".repeat(10 * 1024 * 1024 + 1), "application/json"));
    }
}
