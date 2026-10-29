using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Model;
using Vistoria.Api.Services;
using Vistoria.Api.Services.Impl;

namespace Vistoria.Api.Configurations;

public static class DomainConfig
{
    // Services das entidades do domínio; os repositórios genéricos vêm do AddDatabase.
    public static IServiceCollection AddDomainServices(this IServiceCollection services)
    {
        services.AddScoped<IClientService, ClientService>();
        services.AddScoped<IPropertyService, PropertyService>();
        services.AddScoped<ITemplateService, TemplateService>();
        services.AddScoped<IInspectionService, InspectionService>();
        // Delta por entidade (SyncController).
        services.AddScoped<ISyncService<ClientDto>, SyncService<Client, ClientDto>>();
        services.AddScoped<ISyncService<PropertyDto>, SyncService<Property, PropertyDto>>();
        services.AddScoped<ISyncService<TemplateDto>, SyncService<Template, TemplateDto>>();
        services.AddScoped<ISyncService<InspectionDto>, SyncService<Inspection, InspectionDto>>();
        return services;
    }
}
