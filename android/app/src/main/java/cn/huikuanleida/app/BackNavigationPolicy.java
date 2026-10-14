package cn.huikuanleida.app;

final class BackNavigationPolicy {
    enum Decision { HANDLED, FALLBACK, STAY }
    static Decision interpret(String value) {
        if ("true".equals(value)) return Decision.HANDLED;
        if ("false".equals(value)) return Decision.FALLBACK;
        return Decision.STAY;
    }
}
