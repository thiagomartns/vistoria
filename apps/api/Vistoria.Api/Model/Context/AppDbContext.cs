using Microsoft.EntityFrameworkCore;

namespace Vistoria.Api.Model.Context;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // Cada entidade traz seu IEntityTypeConfiguration em Model/Configurations/.
    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
