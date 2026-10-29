using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;
using Vistoria.Api.Repositories;
using Vistoria.Api.Repositories.Impl;

namespace Vistoria.Api.Configurations;

public static class DatabaseConfig
{
    public const string ConnectionStringName = "Default";

    // Sem connection string no repositório: User Secrets em dev, ConnectionStrings__Default no container.
    // O registro não exige o valor, para a geração do openapi.json no build rodar sem banco.
    public static IServiceCollection AddDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlServer(configuration.GetConnectionString(ConnectionStringName)));
        services.AddScoped(typeof(IRepository<>), typeof(GenericRepository<>));
        services.AddScoped<IInspectionRepository, InspectionRepository>();
        // A vistoria pelo genérico (o delta) também traz o agregado, não um GenericRepository<Inspection> sem filhos.
        services.AddScoped<IRepository<Inspection>>(sp => sp.GetRequiredService<IInspectionRepository>());
        return services;
    }

    // Só em Development. Em produção as migrações rodam no deploy, pelo efbundle.
    public static async Task MigrateDatabaseAsync(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(app.Configuration.GetConnectionString(ConnectionStringName)))
        {
            throw new InvalidOperationException(
                $"ConnectionStrings:{ConnectionStringName} não configurada. Em dev, use User Secrets "
                + "(comando no README, em Primeiros passos).");
        }

        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }
}
