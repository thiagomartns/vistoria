using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Vistoria.Api.Infrastructure.OpenApi;

namespace Vistoria.Api.Tests.Integration;

/// <summary>
/// Recurso de mentira com o formato dos recursos do M2 (GET, PUT, DELETE), para conferir o que os transformers
/// publicam. Fica só no projeto de testes (via <c>TestControllersFactory</c>).
/// </summary>
[ApiController]
[Route("test/contract/widgets/{id:guid}")]
[ProblemResponses(401)]
[SuppressMessage("Performance", "CA1822", Justification = "Ação MVC precisa ser método de instância.")]
public class ContractController : ControllerBase
{
    [HttpGet]
    [EndpointName("getWidget")]
    [ProblemResponses(404)]
    public IActionResult Get(Guid id) => Ok(id);

    [HttpPut]
    [EndpointName("upsertWidget")]
    [ProblemResponses(400, 403, 409, 410, 412, 422, 428, 429)]
    public IActionResult Upsert(Guid id) => Ok(id);

    [HttpDelete]
    [EndpointName("deleteWidget")]
    [ProblemResponses(403, 409, 412, 422, 428, 429)]
    public IActionResult Delete(Guid id) => NoContent();
}
