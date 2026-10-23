using System.Text.Json;
using System.Text.Json.Serialization;
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
            .AddJsonOptions(options => ConfigureJson(options.JsonSerializerOptions))
            .ConfigureApiBehaviorOptions(options =>
                options.InvalidModelStateResponseFactory = context =>
                    throw new ValidationException(ModelStateErrors.From(context)));

        // O gerador do OpenAPI lê as JsonOptions de Http, não as do MVC: sem esta linha o documento publicaria
        // enum como inteiro enquanto a API fala string.
        services.ConfigureHttpJsonOptions(options => ConfigureJson(options.SerializerOptions));

        return services;
    }

    // Número só como número: o padrão Web aceita "3" no lugar de 3, e o OpenAPI publicaria a posição como
    // integer | string, que o front receberia como union.
    private static void ConfigureJson(JsonSerializerOptions options)
    {
        options.NumberHandling = JsonNumberHandling.Strict;
        options.Converters.Add(CreateEnumConverter());
    }

    // Enum como string em camelCase (backend.md, "Contrato da API"). Número não é aceito: "type": 7 desserializaria
    // num valor fora do enum, e "type": 1 num valor válido por acaso.
    private static JsonStringEnumConverter CreateEnumConverter() =>
        new(JsonNamingPolicy.CamelCase, allowIntegerValues: false);
}
