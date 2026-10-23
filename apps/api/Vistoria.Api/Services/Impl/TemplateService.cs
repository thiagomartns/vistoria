using MapsterMapper;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Services.Impl;

public class TemplateService(IRepository<Template> templates, IMapper mapper)
    : SyncEntityService<Template, TemplateDto>(templates, mapper), ITemplateService
{
    private readonly IMapper _mapper = mapper;

    public Task<(TemplateDto Template, bool Created)> UpsertAsync(
        Guid ownerId, Guid id, string? ifMatch, UpsertTemplateDto request, CancellationToken cancellationToken) =>
        UpsertAsync(ownerId, id, ifMatch, _mapper.Map<Template>(request), cancellationToken);

    // O que as Data Annotations não alcançam: elemento nulo na lista (o validador do MVC o pula) e id repetido. O
    // editor usa os ids como chave de ambiente e item, então eles são únicos no roteiro todo, não só no ambiente.
    protected override Task ValidateAsync(Template proposed, Guid ownerId, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var roomIds = new HashSet<Guid>();
        var itemIds = new HashSet<Guid>();
        for (var r = 0; r < proposed.Rooms.Count; r++)
        {
            var room = proposed.Rooms[r];
            if (room is null)
            {
                errors[$"rooms[{r}]"] = ["Informe o ambiente."];
                continue;
            }

            if (!roomIds.Add(room.Id))
            {
                errors[$"rooms[{r}].id"] = ["Id de ambiente repetido no roteiro."];
            }

            for (var i = 0; i < room.Items.Count; i++)
            {
                var item = room.Items[i];
                if (item is null)
                {
                    errors[$"rooms[{r}].items[{i}]"] = ["Informe o item."];
                }
                else if (!itemIds.Add(item.Id))
                {
                    errors[$"rooms[{r}].items[{i}].id"] = ["Id de item repetido no roteiro."];
                }
            }
        }

        return errors.Count > 0 ? throw new ValidationException(errors) : Task.CompletedTask;
    }
}
