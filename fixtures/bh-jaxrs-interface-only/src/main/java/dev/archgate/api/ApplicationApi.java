package dev.archgate.api;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/api/applications")
public interface ApplicationApi {
    @GET
    @Path("/{id}")
    String getApplication(String id);
}
