package dev.archgate;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/applications")
public final class ApplicationResource {
    @GET
    @Path("/{id}")
    public String getApplication(String id) {
        return id;
    }
}
