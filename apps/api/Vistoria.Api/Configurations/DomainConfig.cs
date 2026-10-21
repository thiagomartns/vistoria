using Vistoria.Api.Services;
using Vistoria.Api.Services.Impl;

namespace Vistoria.Api.Configurations;

public static class DomainConfig
{
    // Services das entidades do domínio; os repositórios genéricos vêm do AddDatabase.
    public static IServiceCollection AddDomainServices(this IServiceCollection services)
    {
        services.AddScoped<IClientService, ClientService>();
        return services;
    }
}
