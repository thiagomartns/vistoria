using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding.Metadata;
using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Configurations;

public static class ControllersConfig
{
    public static IServiceCollection AddApiControllers(this IServiceCollection services)
    {
        services
            .AddControllers(options =>
            {
                options.Filters.Add(new ProducesAttribute("application/json"));
                // Erros de validação com o nome JSON do campo (camelCase), não o nome da propriedade .NET.
                options.ModelMetadataDetailsProviders.Add(new SystemTextJsonValidationMetadataProvider());
            })
            // Model state inválido segue o mesmo caminho de uma ValidationException lançada por um service:
            // o GlobalExceptionHandler escreve os dois, então o formato é um só.
            .ConfigureApiBehaviorOptions(options =>
                options.InvalidModelStateResponseFactory = context =>
                    throw new ValidationException(ModelStateErrors.From(context)));

        return services;
    }
}
