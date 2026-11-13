package dev.archgate;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/admin")
public final class AdminResource {
    @GET
    public String getAdmin() {
        return "secret";
    }
}
