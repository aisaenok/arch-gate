package dev.archgate;

import dev.archgate.api.ApplicationApi;

public final class ApplicationController implements ApplicationApi {
    @Override
    public String getApplication(String id) {
        return id;
    }
}
