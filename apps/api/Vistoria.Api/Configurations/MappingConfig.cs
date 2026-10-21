using Mapster;
using MapsterMapper;

namespace Vistoria.Api.Configurations;

public static class MappingConfig
{
    // Uma configuração própria, não a GlobalSettings estática: cada host (e cada factory de teste) tem a sua.
    public static IServiceCollection AddMappings(this IServiceCollection services)
    {
        var config = new TypeAdapterConfig();
        // Rowversion → base64, o mesmo valor do ETag sem aspas.
        config.NewConfig<byte[], string>().MapWith(version => Convert.ToBase64String(version));
        config.Scan(typeof(MappingConfig).Assembly);

        services.AddSingleton(config);
        services.AddSingleton<IMapper>(new Mapper(config));
        return services;
    }
}
