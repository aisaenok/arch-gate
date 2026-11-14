package dev.archgate;

import dev.archgate.api.ApplicationApi;

public final class ApplicationController implements ApplicationApi {
    public String getApplication(String id, String locale) {
        return id + locale;
    }
}
