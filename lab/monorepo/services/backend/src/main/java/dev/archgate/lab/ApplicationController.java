package dev.archgate.lab;

import dev.archgate.lab.api.ApplicationApi;
import dev.archgate.lab.api.ApplicationResponse;

public final class ApplicationController implements ApplicationApi {
    @Override
    public ApplicationResponse getApplication(String id) {
        return new ApplicationResponse(id, "APPROVED");
    }
}
