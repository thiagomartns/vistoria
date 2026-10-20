using System.ComponentModel.DataAnnotations;
using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Vistoria.Api.Infrastructure.Errors;
using ValidationException = Vistoria.Api.Infrastructure.Errors.ValidationException;

namespace Vistoria.Api.Tests.Integration;

public sealed record ValidationItemDto
{
    [Required, MaxLength(3)]
    public string Name { get; init; } = "";

    [Range(1, 99)]
    public int Quantity { get; init; } = 1;
}

public sealed record ValidationDto
{
    [Required]
    public string Title { get; init; } = "";

    [Required]
    public List<ValidationItemDto> Items { get; init; } = [];
}

/// <summary>
/// Recebe um corpo com lista aninhada e lança a exceção de validação como um service faria. Fica só no projeto
/// de testes (via <c>TestControllersFactory</c>).
/// </summary>
[ApiController]
[Route("test/validation")]
[SuppressMessage("Performance", "CA1822", Justification = "Ação MVC precisa ser método de instância.")]
public class ValidationController : ControllerBase
{
    public const string ServicePath = "rooms[2].items[4].condition";

    [HttpPost]
    [EndpointName("postValidation")]
    public IActionResult Post(ValidationDto body) => Ok(body);

    [HttpPost("service")]
    [EndpointName("postValidationFromService")]
    public IActionResult FromService(ValidationDto body) =>
        throw new ValidationException(ServicePath, "Obrigatório.");
}
